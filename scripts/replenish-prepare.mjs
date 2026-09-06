#!/usr/bin/env node
/**
 * Deterministic glue for the Content replenish workflow. Everything an agent
 * must not be trusted to do -- turn its page selection into manifest rows,
 * decide what is re-validated, stage the authoring copies, enforce the caps,
 * scope the review, demote what the reviewer rejected, write the PR body --
 * lives here so it is testable and so the agents' allowed tools stay
 * read-mostly.
 *
 * Subcommands:
 *   manifest --select select.json --candidates candidates.json --out selected.json
 *       Validate the author's page selection against the discovery report and
 *       the course maps; write the valid rows (nothing is appended yet) and
 *       print one tab-separated capture line per row.
 *   manifest-commit --selected selected.json --captured <id,id,...>
 *       Append to content/capture-manifest.yaml only the rows whose capture
 *       succeeded, so a failed capture never leaves an orphan row that would
 *       hide the page from discovery for good.
 *   capture-args --candidates candidates.json
 *       Print capture lines for the drifted sources, from their own records.
 *   stage [--all | <src-id> ...]
 *       Write captured/<id>.md from the R2 snapshot each record names.
 *   revalidation-ids --sources <id,id,...>
 *       Print the needs_review question ids citing any of those sources.
 *   guard --base <git ref> [--max <n>] [--forbid-published-now]
 *       Fail when more than <n> question files changed against the base
 *       (untracked files included; --max omitted disables the cap) or when
 *       any file that was `published` or
 *       `retired` at the base changed at all. With --forbid-published-now
 *       (the author phase) also fail when a changed file is published or
 *       retired NOW: the agent never publishes anything itself.
 *   review-ids --base <git ref>
 *       Print the review_ready question ids that differ from the base.
 *   reconcile-decisions --ids review-ids.txt --decisions decisions.json --out filtered.json
 *       Fail unless the reviewer decided on exactly the listed ids; write the
 *       decisions scoped to them.
 *   demote <q-id> ...
 *       status -> needs_review and drop `reviewed` (a rejected re-validation).
 *   pr-body --candidates c.json --receipt r.json --captured <id,...> [--before b.json --after a.json] [--max n]
 *       Print the generated section of the pull request body.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, parseDocument, isSeq } from "yaml";
import { loadCourses, loadSources, loadYamlDir } from "./lib/content-model.mjs";
import { storeFromEnv } from "./lib/snapshot-store.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(ROOT, "content");

const SOURCE_ID = /^src-[a-z0-9][a-z0-9-]{2,62}$/;
const OBJECTIVE = /^domain-[1-9][0-9]*\/[a-z0-9][a-z0-9-]{1,62}$/;
const QUESTION_ID = /^q-[a-z0-9]{12}$/;

export function knownObjectives(contentDir = CONTENT) {
  const set = new Set();
  for (const course of loadCourses(contentDir).values()) {
    for (const d of course.domains ?? []) for (const o of d.objectives ?? []) set.add(`${d.id}/${o.id}`);
  }
  return set;
}

/**
 * Keep only rows the report offered and the course maps can place. A dropped
 * row is reported, never silently fixed: the agent's job was to choose, and a
 * choice outside the offered set is a signal, not a typo.
 */
export function validateSelection({ select, candidates, objectives, existingIds }) {
  const offered = new Map(candidates.newPages.map((p) => [p.url, p]));
  const rows = [];
  const dropped = [];
  const seen = new Set();
  for (const row of Array.isArray(select) ? select : []) {
    const why = [];
    if (typeof row?.id !== "string" || !SOURCE_ID.test(row.id)) why.push("bad id");
    else if (existingIds.has(row.id) || seen.has(row.id)) why.push("id already taken");
    if (!offered.has(row?.url)) why.push("url not in the discovery report");
    else if (seen.has(row.url)) why.push("url already selected under another id");
    if (typeof row?.title !== "string" || !row.title.trim() || /[\t\r\n]/.test(row.title))
      why.push("bad title");
    const objs = Array.isArray(row?.objectives) ? row.objectives.filter((o) => typeof o === "string") : [];
    const valid = objs.filter((o) => OBJECTIVE.test(o) && objectives.has(o));
    if (!valid.length) why.push("no objective from the course maps");
    if (why.length) {
      dropped.push({ row, why });
      continue;
    }
    seen.add(row.id);
    seen.add(row.url);
    rows.push({ id: row.id, url: row.url, title: row.title.trim(), objectives: [...new Set(valid)] });
  }
  return { rows, dropped };
}

export function appendManifestRows(manifestFile, rows) {
  if (!rows.length) return;
  const doc = parseDocument(readFileSync(manifestFile, "utf8"));
  const seq = doc.get("sources");
  if (!isSeq(seq)) throw new Error("capture-manifest.yaml has no sources list");
  for (const row of rows) seq.add(doc.createNode(row));
  writeFileSync(manifestFile, doc.toString());
}

const captureLine = (r) => [r.id, r.url, r.title, r.objectives.join(",")].join("\t");
const splitIds = (text) =>
  (text ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function revalidationIds({ contentDir = CONTENT, sourceIds }) {
  const wanted = new Set(sourceIds);
  return loadYamlDir(contentDir, "questions")
    .map((e) => e.data)
    .filter((q) => q.status === "needs_review" && (q.evidence ?? []).some((ev) => wanted.has(ev.source_id)))
    .map((q) => q.id)
    .sort();
}

const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/**
 * Question files that differ from the base: tracked changes AND untracked
 * files. `git diff` alone never lists a file the author agent just created,
 * which is its dominant output.
 */
export function changedQuestionFiles({ base, cwd = process.cwd() }) {
  const tracked = git(["diff", "--name-only", base, "--", "content/questions"], cwd);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "--", "content/questions"], cwd);
  return [...new Set([...tracked.split("\n"), ...untracked.split("\n")].filter(Boolean))].sort();
}

export function statusAtRef({ base, file, cwd = process.cwd() }) {
  try {
    return parseYaml(git(["show", `${base}:${file}`], cwd))?.status ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {object} args
 * @param {string[]} args.changed  question files changed against the base
 * @param {(file: string) => string | null} args.statusAtBase  null when absent at base
 * @param {number | null} args.max  null disables the cap (the post-promotion call)
 * @param {(file: string) => string | null} [args.statusNow]  current status; when given, a
 *   changed file that is now `published` or `retired` is rejected too. That is the
 *   author-phase rule: the agent may only ever leave a file review_ready or needs_review,
 *   never publish one itself (a backdated human `reviewed` block would otherwise pass
 *   the lint). The post-promotion guard omits it.
 */
export function guardChanges({ changed, statusAtBase, max, statusNow = null }) {
  const problems = [];
  if (max !== null) {
    if (!Number.isInteger(max) || max < 0) problems.push(`cap must be a non-negative integer, got ${max}`);
    else if (changed.length > max) problems.push(`${changed.length} question files changed, cap is ${max}`);
  }
  for (const file of changed) {
    const status = statusAtBase(file);
    if (status === "published") problems.push(`${file} was published at the base and must not change here`);
    if (status === "retired") problems.push(`${file} is retired and must not change here`);
    if (statusNow) {
      const now = statusNow(file);
      if (now === "published" || now === "retired") {
        problems.push(
          `${file} is ${now} after authoring; only review_ready or needs_review may leave this step`,
        );
      }
      if (now === "unparseable") problems.push(`${file} is not parseable YAML after authoring`);
    }
  }
  return problems;
}

export function statusOnDisk({ file, cwd = process.cwd() }) {
  const abs = join(cwd, file);
  if (!existsSync(abs)) return null;
  try {
    return parseYaml(readFileSync(abs, "utf8"))?.status ?? null;
  } catch {
    return "unparseable";
  }
}

/** review_ready ids among the files that differ from the base, read as YAML. */
export function reviewIds({ base, cwd = process.cwd() }) {
  const ids = [];
  for (const file of changedQuestionFiles({ base, cwd })) {
    const abs = join(cwd, file);
    if (!existsSync(abs)) continue;
    const data = parseYaml(readFileSync(abs, "utf8"));
    if (data?.status === "review_ready" && typeof data.id === "string") ids.push(data.id);
  }
  return ids.sort();
}

/**
 * The reviewer decides on exactly the items this run put in front of it:
 * an id it added would be promoted outside the run's cap and diff, an id it
 * skipped would ship unreviewed and unmentioned.
 */
export function reconcileDecisions({ ids, decisions }) {
  const wanted = new Set(ids);
  const list = Array.isArray(decisions) ? decisions : [];
  const decided = new Set(list.map((d) => d?.id).filter((id) => typeof id === "string"));
  const extra = [...decided].filter((id) => !wanted.has(id)).sort();
  const missing = [...wanted].filter((id) => !decided.has(id)).sort();
  const problems = [];
  if (extra.length) problems.push(`decisions for ids not under review: ${extra.join(", ")}`);
  if (missing.length) problems.push(`no decision for: ${missing.join(", ")}`);
  return { problems, decisions: list.filter((d) => wanted.has(d?.id)) };
}

export function demote(contentDir, ids) {
  for (const id of ids) {
    if (!QUESTION_ID.test(id)) throw new Error(`refusing to demote ${JSON.stringify(id)}: not a question id`);
    const file = join(contentDir, "questions", `${id}.yaml`);
    const doc = parseDocument(readFileSync(file, "utf8"));
    doc.set("status", "needs_review");
    doc.delete("reviewed");
    writeFileSync(file, doc.toString());
  }
}

export function prBody({
  candidates,
  receipt,
  captured = [],
  selected = [],
  before = null,
  after = null,
  dropped = [],
  max = null,
}) {
  const approved = receipt.questions.filter((q) => q.approved);
  const rejected = receipt.questions.filter((q) => !q.approved);
  const capturedSet = new Set(captured);
  const capturedUrls = new Set(selected.filter((r) => capturedSet.has(r.id)).map((r) => r.url));
  const lines = ["## Replenish run", ""];
  lines.push(
    `Discovery: ${candidates.newPagesTotal} uncited pages in the indices, ${candidates.newPages.length} offered, ${candidates.drifted.length} drifted sources, ${(candidates.unreachable ?? []).length} unreachable, ${candidates.gaps.length} gaps.`,
    "",
  );
  lines.push("### Sources captured in this PR", "");
  let any = false;
  for (const id of captured) {
    const d = candidates.drifted.find((x) => x.id === id);
    const row = selected.find((r) => r.id === id);
    if (d) lines.push(`- re-captured \`${id}\` [${d.classification}] ${d.summary || d.url}`);
    else lines.push(`- new \`${id}\`${row ? ` — ${row.title}: ${row.url}` : ""}`);
    any = true;
  }
  if (!any) lines.push("- none");
  const offeredNotCaptured = candidates.newPages.filter((p) => !capturedUrls.has(p.url));
  if (offeredNotCaptured.length) {
    lines.push("", "### Offered by discovery, not captured this run", "");
    for (const p of offeredNotCaptured) lines.push(`- ${p.title} — ${p.url}`);
  }
  for (const d of dropped)
    lines.push(`- dropped selection ${JSON.stringify(d.row?.id ?? d.row)}: ${d.why.join("; ")}`);
  if (candidates.unreachable?.length) {
    lines.push("", "### Unreachable sources (not changed here; needs a human decision)", "");
    for (const u of candidates.unreachable) {
      lines.push(`- \`${u.id}\`${u.status === 404 ? " page gone (HTTP 404)" : ""}: ${u.message}`);
    }
  }
  lines.push("", `### Review by \`${receipt.reviewer}\` (${receipt.reviewed_at})`, "");
  lines.push(
    `${approved.length} approved and promoted, ${rejected.length} rejected.${max !== null ? ` Cap for this run: ${max} question files.` : ""}`,
  );
  for (const q of rejected) lines.push(`- rejected \`${q.id}\`: ${q.reason}`);
  if (before && after) {
    lines.push("", "### Mock shortfall before → after", "");
    for (const c of after) {
      const prev = before.find((b) => b.course === c.course);
      const cells = c.domains.map(
        (d) => `${d.id} ${prev?.domains.find((x) => x.id === d.id)?.mockShortfall ?? "?"}→${d.mockShortfall}`,
      );
      lines.push(`- ${c.course}: ${cells.join(", ")} (published ${prev?.published ?? "?"}→${c.published})`);
    }
  }
  lines.push(
    "",
    "Receipt and fingerprints are committed under `docs/content/`. Evidence CI verifies every excerpt against the R2 snapshot. Attestation is signed by the human merging this PR, not by the workflow.",
  );
  return lines.join("\n");
}

function opt(args, name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  if (i + 1 >= args.length || args[i + 1].startsWith("--")) throw new Error(`--${name} needs a value`);
  return args[i + 1];
}
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

async function main(argv) {
  const [cmd, ...args] = argv;
  if (cmd === "manifest") {
    const select = readJson(opt(args, "select"));
    const candidates = readJson(opt(args, "candidates"));
    const out = opt(args, "out") ?? "selected.json";
    const existingIds = new Set(loadSources(CONTENT).keys());
    const manifestFile = join(CONTENT, "capture-manifest.yaml");
    for (const row of parseYaml(readFileSync(manifestFile, "utf8"))?.sources ?? []) existingIds.add(row.id);
    const { rows, dropped } = validateSelection({
      select,
      candidates,
      objectives: knownObjectives(),
      existingIds,
    });
    for (const d of dropped)
      console.error(`::warning::dropped selection ${JSON.stringify(d.row)}: ${d.why.join("; ")}`);
    writeFileSync(out, JSON.stringify(rows, null, 2));
    writeFileSync("dropped.json", JSON.stringify(dropped, null, 2));
    for (const r of rows) console.log(captureLine(r));
    return;
  }
  if (cmd === "manifest-commit") {
    const rows = readJson(opt(args, "selected"));
    const captured = new Set(splitIds(opt(args, "captured")));
    appendManifestRows(
      join(CONTENT, "capture-manifest.yaml"),
      rows.filter((r) => captured.has(r.id)),
    );
    return;
  }
  if (cmd === "capture-args") {
    const candidates = readJson(opt(args, "candidates"));
    const sources = loadSources(CONTENT);
    for (const d of candidates.drifted) {
      const rec = sources.get(d.id);
      if (!rec || !(rec.objectives ?? []).length) continue;
      console.log(captureLine({ id: rec.id, url: rec.url, title: rec.title, objectives: rec.objectives }));
    }
    return;
  }
  if (cmd === "stage") {
    const store = storeFromEnv();
    if (!store) throw new Error("snapshot store is not configured");
    const sources = loadSources(CONTENT);
    const ids = args.includes("--all") ? [...sources.keys()] : args;
    mkdirSync("captured", { recursive: true });
    for (const id of ids) {
      const rec = sources.get(id);
      if (!rec) throw new Error(`${id}: no such source record`);
      if (rec.status === "deprecated") continue;
      if (!rec.snapshot?.key) {
        console.warn(`::warning::${id}: no snapshot recorded yet; not staged`);
        continue;
      }
      const text = await store.get(rec.snapshot.key);
      if (text === null) throw new Error(`${id}: snapshot ${rec.sha256} absent from the store`);
      writeFileSync(join("captured", `${id}.md`), text, "utf8");
      console.log(`staged captured/${id}.md`);
    }
    return;
  }
  if (cmd === "revalidation-ids") {
    console.log(revalidationIds({ sourceIds: splitIds(opt(args, "sources")) }).join(" "));
    return;
  }
  if (cmd === "guard") {
    const base = opt(args, "base");
    // Without --max there is no cap: the post-promotion call re-checks the
    // base-status rule over a set that legitimately includes the items the
    // mechanical re-validation repaired, which were never the agent's to cap.
    const maxArg = opt(args, "max");
    const max = maxArg === undefined ? null : Number(maxArg);
    const changed = changedQuestionFiles({ base });
    const problems = guardChanges({
      changed,
      statusAtBase: (file) => statusAtRef({ base, file }),
      max,
      statusNow: args.includes("--forbid-published-now") ? (file) => statusOnDisk({ file }) : null,
    });
    for (const p of problems) console.error(`::error::${p}`);
    console.log(`${changed.length} question file(s) changed against ${base}`);
    if (problems.length) process.exit(1);
    return;
  }
  if (cmd === "review-ids") {
    console.log(reviewIds({ base: opt(args, "base") }).join("\n"));
    return;
  }
  if (cmd === "reconcile-decisions") {
    const ids = readFileSync(opt(args, "ids"), "utf8")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const { problems, decisions } = reconcileDecisions({ ids, decisions: readJson(opt(args, "decisions")) });
    for (const p of problems) console.error(`::error::${p}`);
    if (problems.length) process.exit(1);
    writeFileSync(opt(args, "out"), JSON.stringify(decisions, null, 2));
    console.log(`${decisions.length} decision(s) scoped to the items under review`);
    return;
  }
  if (cmd === "demote") {
    demote(CONTENT, args);
    return;
  }
  if (cmd === "pr-body") {
    const maxArg = opt(args, "max");
    const body = prBody({
      candidates: readJson(opt(args, "candidates")),
      receipt: readJson(opt(args, "receipt")),
      captured: splitIds(opt(args, "captured")),
      selected:
        opt(args, "selected") && existsSync(opt(args, "selected")) ? readJson(opt(args, "selected")) : [],
      before: opt(args, "before") ? readJson(opt(args, "before")) : null,
      after: opt(args, "after") ? readJson(opt(args, "after")) : null,
      dropped: existsSync("dropped.json") ? readJson("dropped.json") : [],
      max: maxArg === undefined ? null : Number(maxArg),
    });
    console.log(body);
    return;
  }
  throw new Error(`unknown subcommand ${cmd}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`replenish-prepare: ${e.message}`);
    process.exit(1);
  });
}
