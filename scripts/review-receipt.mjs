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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { AGENT_ID, questionFingerprint } from "./lib/question-review.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(ROOT, "content");

const ID = /^q-[a-z0-9]+$/;

/**
 * @param {object} args
 * @param {string} args.reviewer
 * @param {{ id: string, approved: boolean, reason: string }[]} args.decisions
 * @param {object | null} [args.existing] a receipt to merge into (entries replaced by id)
 */
export function buildReceipt({
  contentDir = CONTENT,
  reviewer,
  decisions,
  existing = null,
  now = new Date(),
}) {
  if (typeof reviewer !== "string" || !(AGENT_ID.test(reviewer) || /^[A-Za-z0-9-]{2,}$/.test(reviewer))) {
    throw new Error(`reviewer must be agent:<name> or a GitHub handle, got ${JSON.stringify(reviewer)}`);
  }
  if (!Array.isArray(decisions) || !decisions.length) throw new Error("decisions must be a non-empty array");
  if (existing && existing.reviewer !== reviewer) {
    throw new Error(`receipt belongs to ${existing.reviewer}; refusing to merge decisions by ${reviewer}`);
  }
  const seen = new Set();
  const entries = [];
  for (const d of decisions) {
    if (typeof d?.id !== "string" || !ID.test(d.id))
      throw new Error(`decision without a valid id: ${JSON.stringify(d)}`);
    if (seen.has(d.id))
      throw new Error(`duplicate decision for ${d.id}; the promotion CLI rejects double entries`);
    seen.add(d.id);
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
    });
  }
  const kept = (existing?.questions ?? []).filter((e) => !seen.has(e.id));
  return {
    reviewer,
    reviewed_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    questions: [...kept, ...entries],
  };
}

function parseArgs(argv) {
  const opts = { reviewer: null, decisions: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--reviewer") opts.reviewer = argv[++i];
    else if (a === "--decisions") opts.decisions = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  if (!opts.reviewer || !opts.decisions || !opts.out) {
    throw new Error("usage: review-receipt.mjs --reviewer <id> --decisions <json> --out <receipt.json>");
  }
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const decisions = JSON.parse(readFileSync(opts.decisions, "utf8"));
    const existing = existsSync(opts.out) ? JSON.parse(readFileSync(opts.out, "utf8")) : null;
    const receipt = buildReceipt({ reviewer: opts.reviewer, decisions, existing });
    writeFileSync(opts.out, JSON.stringify(receipt, null, 2) + "\n");
    const approved = receipt.questions.filter((q) => q.approved).map((q) => q.id);
    console.log(`wrote ${opts.out}: ${receipt.questions.length} entries, ${approved.length} approved`);
    if (approved.length) console.log(approved.join(" "));
  } catch (e) {
    console.error(`review-receipt: ${e.message}`);
    process.exit(1);
  }
}
