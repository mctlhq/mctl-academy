#!/usr/bin/env node
/**
 * Turns an independent reviewer's decisions into the committed receipt the
 * lint and the promotion CLI check (docs/content/<name>-review.json).
 *
 * The reviewer -- human or agent -- writes only `{ id, approved, reason }`.
 * The fingerprint is computed here from the files on disk with the canonical
 * helper, so a reviewer can neither miscompute it nor approve a revision it
 * did not read: the receipt is bound to exactly the bytes present when this
 * ran, and any later edit makes it stale.
 *
 * Usage:
 *   node scripts/review-receipt.mjs --reviewer agent:<name> --decisions decisions.json \
 *        --out docs/content/<name>-review.json
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { AGENT_ID, questionFingerprint } from "./lib/question-review.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(ROOT, "content");

// Same pattern as content/schemas/question.schema.json: a malformed id is
// rejected here, not one job later by the lint.
const ID = /^q-[a-z0-9]{12}$/;

/**
 * `${reviewer}|${id}` -> file, for every `*-review.json` in the directory of
 * `out` other than `out` itself. loadReviewReceipts discards BOTH entries when
 * one reviewer names one id in two files, so a re-review into a new file would
 * silently revoke the approval it meant to refresh; buildReceipt refuses that
 * unless the caller supersedes the older entries (see supersedeElsewhere).
 */
export function entriesElsewhere(out) {
  const dir = dirname(out);
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir).filter((n) => n.endsWith("-review.json") && n !== basename(out))) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
      for (const e of r.questions ?? [])
        if (typeof e?.id === "string") map.set(`${r.reviewer}|${e.id}`, join(dir, f));
    } catch {
      // An unreadable receipt is the lint's to report, not ours to hide behind.
    }
  }
  return map;
}

/**
 * @param {object} args
 * @param {string} [args.contentDir]
 * @param {string} args.reviewer
 * @param {{ id: string, approved: boolean, reason: string }[]} args.decisions
 * @param {{ reviewer: string, reviewed_at?: string, questions: any[], superseded?: any[] } | null} [args.existing] a receipt to merge into (entries replaced by id)
 * @param {Map<string, string>} [args.elsewhere] from entriesElsewhere()
 * @param {Date} [args.now]
 */
export function buildReceipt({
  contentDir = CONTENT,
  reviewer,
  decisions,
  existing = null,
  elsewhere = new Map(),
  now = new Date(),
}) {
  // A human handle is accepted for the record only: the lint consults
  // receipts for `agent:` reviewers alone (receiptProblems); a human approval
  // stands on the `reviewed` block itself.
  if (typeof reviewer !== "string" || !(AGENT_ID.test(reviewer) || /^[A-Za-z0-9-]{2,}$/.test(reviewer))) {
    throw new Error(`reviewer must be agent:<name> or a GitHub handle, got ${JSON.stringify(reviewer)}`);
  }
  if (!Array.isArray(decisions) || !decisions.length) throw new Error("decisions must be a non-empty array");
  if (existing && existing.reviewer !== reviewer) {
    throw new Error(`receipt belongs to ${existing.reviewer}; refusing to merge decisions by ${reviewer}`);
  }
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const seen = new Set();
  const entries = [];
  for (const d of decisions) {
    if (typeof d?.id !== "string" || !ID.test(d.id))
      throw new Error(`decision without a valid id: ${JSON.stringify(d)}`);
    if (seen.has(d.id))
      throw new Error(`duplicate decision for ${d.id}; the promotion CLI rejects double entries`);
    seen.add(d.id);
    const other = elsewhere.get(`${reviewer}|${d.id}`);
    if (other)
      throw new Error(`${d.id}: ${reviewer} already has an entry in ${other}; re-review into that file`);
    if (typeof d.approved !== "boolean") throw new Error(`${d.id}: approved must be true or false`);
    if (typeof d.reason !== "string" || !d.reason.trim()) throw new Error(`${d.id}: a reason is required`);
    const file = join(contentDir, "questions", `${d.id}.yaml`);
    if (!existsSync(file)) throw new Error(`${d.id}: no such question file`);
    const question = parseYaml(readFileSync(file, "utf8"));
    if (question?.id !== d.id) throw new Error(`${d.id}: file id mismatch (${question?.id})`);
    if (question.status !== "review_ready")
      throw new Error(`${d.id}: status is ${question.status}, only review_ready items are reviewed`);
    if (question.authored?.by === reviewer)
      throw new Error(`${d.id}: ${reviewer} authored this revision and cannot review it`);
    entries.push({
      id: d.id,
      content_sha256: questionFingerprint(question),
      approved: d.approved,
      reason: d.reason.trim(),
      reviewed_at: stamp,
    });
  }
  // Carried-over entries keep their own timestamp: they were not re-read.
  const kept = (existing?.questions ?? [])
    .filter((e) => !seen.has(e.id))
    .map((e) => ({ ...e, reviewed_at: e.reviewed_at ?? existing?.reviewed_at }));
  /** @type {Record<string, any>} */
  const result = { reviewer, reviewed_at: stamp, questions: [...kept, ...entries] };
  // supersedeElsewhere writes this list precisely so the earlier approval and
  // the bytes it was bound to stay on the record. Rebuilding the receipt from
  // reviewer/questions alone would erase it on the manual append path, where
  // the loss is a commit rather than a discarded runner.
  if (Array.isArray(existing?.superseded)) result.superseded = existing.superseded;
  return result;
}

/**
 * A re-review after a later drift (quarantine -> re-validation -> review_ready)
 * presents an id the reviewer decided on in an earlier run. Remove that
 * reviewer's older entries for the given ids from the other receipt files so
 * the new receipt holds the one decision that counts. Returns what was removed.
 */
export function supersedeElsewhere({ out, reviewer, ids }) {
  const removed = [];
  const dir = dirname(out);
  if (!existsSync(dir)) return removed;
  const wanted = new Set(ids);
  for (const f of readdirSync(dir).filter((n) => n.endsWith("-review.json") && n !== basename(out))) {
    const file = join(dir, f);
    let r;
    try {
      r = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (r?.reviewer !== reviewer || !Array.isArray(r.questions)) continue;
    const keep = r.questions.filter((e) => !wanted.has(e?.id));
    if (keep.length === r.questions.length) continue;
    const moved = r.questions.filter((e) => wanted.has(e?.id));
    for (const e of moved) removed.push({ id: e.id, file });
    // The entry leaves `questions` -- loadReviewReceipts keys on
    // `${reviewer}|${id}` and poisons a duplicate -- but it is kept under
    // `superseded`, which nothing in the gate reads. The fingerprint that
    // bound that approval to the bytes reviewed on the day survives as the
    // audit record CONTENT-POLICY asks for.
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const superseded = [
      ...(Array.isArray(r.superseded) ? r.superseded : []),
      ...moved.map((e) => ({ ...e, superseded_at: stamp })),
    ];
    writeFileSync(file, JSON.stringify({ ...r, questions: keep, superseded }, null, 2) + "\n");
  }
  return removed;
}

function parseArgs(argv) {
  const opts = { reviewer: null, decisions: null, out: null, supersede: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--reviewer") opts.reviewer = argv[++i];
    else if (a === "--decisions") opts.decisions = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--supersede") opts.supersede = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!opts.reviewer || !opts.decisions || !opts.out) {
    throw new Error("usage: review-receipt.mjs --reviewer <id> --decisions <json> --out <name>-review.json");
  }
  // loadReviewReceipts reads only `*-review.json`; any other name is a
  // receipt the promotion CLI accepts and the lint never sees.
  if (!opts.out.endsWith("-review.json")) throw new Error("--out must end in -review.json");
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const decisions = JSON.parse(readFileSync(opts.decisions, "utf8"));
    const existing = existsSync(opts.out) ? JSON.parse(readFileSync(opts.out, "utf8")) : null;
    // Build and validate BEFORE touching any other receipt: a rejected
    // decision must not leave an earlier receipt stripped of an approval it
    // still owns. With --supersede the collision this would report is the
    // very thing being replaced, so it is not consulted.
    const receipt = buildReceipt({
      reviewer: opts.reviewer,
      decisions,
      existing,
      elsewhere: opts.supersede ? new Map() : entriesElsewhere(opts.out),
    });
    if (opts.supersede) {
      const ids = (Array.isArray(decisions) ? decisions : [])
        .map((d) => d?.id)
        .filter((id) => typeof id === "string");
      for (const r of supersedeElsewhere({ out: opts.out, reviewer: opts.reviewer, ids })) {
        console.log(`superseded earlier decision for ${r.id} in ${r.file}`);
      }
    }
    writeFileSync(opts.out, JSON.stringify(receipt, null, 2) + "\n");
    const approved = receipt.questions.filter((q) => q.approved).map((q) => q.id);
    console.log(`wrote ${opts.out}: ${receipt.questions.length} entries, ${approved.length} approved`);
    if (approved.length) console.log(approved.join(" "));
  } catch (e) {
    console.error(`review-receipt: ${e.message}`);
    process.exit(1);
  }
}
