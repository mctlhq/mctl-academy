#!/usr/bin/env node
/**
 * Deterministic glue for the Content replenish workflow. Everything an agent
 * must not be trusted to do -- turn its page selection into manifest rows,
 * decide what is re-validated, stage the authoring copies, enforce the caps,
 * demote what the reviewer rejected, write the PR body -- lives here so it is
 * testable and so the agents' allowed tools stay read-mostly.
 *
 * Subcommands:
 *   manifest --select select.json --candidates candidates.json
 *       Validate the author's page selection against the discovery report and
 *       the course maps, append the rows to content/capture-manifest.yaml and
 *       print one tab-separated capture line per row.
 *   capture-args --candidates candidates.json
 *       Print capture lines for the drifted sources, from their own records.
 *   stage [--all | <src-id> ...]
 *       Write captured/<id>.md from the R2 snapshot each record names.
 *   revalidation-ids --sources <id,id,...>
 *       Print the needs_review question ids citing any of those sources.
 *   guard --base <git ref> --max <n>
 *       Fail when more than <n> question files changed against the base or
 *       when any file that was `published` at the base changed at all.
 *   demote <q-id> ...
 *       status -> needs_review and drop `reviewed` (a rejected re-validation).
 *   pr-body --candidates c.json --receipt r.json [--before b.json --after a.json]
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
    rows.push({ id: row.id, url: row.url, title: row.title.trim(), objectives: [...new Set(valid)] });
  }
  return { rows, dropped };
}

export function appendManifestRows(manifestFile, rows) {
  const doc = parseDocument(readFileSync(manifestFile, "utf8"));
  const seq = doc.get("sources");
  if (!isSeq(seq)) throw new Error("capture-manifest.yaml has no sources list");
  for (const row of rows) seq.add(doc.createNode(row));
  writeFileSync(manifestFile, doc.toString());
}

const captureLine = (r) => [r.id, r.url, r.title, r.objectives.join(",")].join("\t");

export function revalidationIds({ contentDir = CONTENT, sourceIds }) {
  const wanted = new Set(sourceIds);
  return loadYamlDir(contentDir, "questions")
    .map((e) => e.data)
    .filter((q) => q.status === "needs_review" && (q.evidence ?? []).some((ev) => wanted.has(ev.source_id)))
    .map((q) => q.id)
    .sort();
}

/**
 * @param {object} args
 * @param {string[]} args.changed  question files changed against the base
 * @param {(file: string) => string | null} args.statusAtBase  null when absent at base
 * @param {number} args.max
 */
export function guardChanges({ changed, statusAtBase, max }) {
  const problems = [];
  if (changed.length > max) problems.push(`${changed.length} question files changed, cap is ${max}`);
  for (const file of changed) {
    const status = statusAtBase(file);
    if (status === "published") problems.push(`${file} was published at the base and must not change here`);
    if (status === "retired") problems.push(`${file} is retired and must not change here`);
  }
  return problems;
}

export function demote(contentDir, ids) {
  for (const id of ids) {
    const file = join(contentDir, "questions", `${id}.yaml`);
    const doc = parseDocument(readFileSync(file, "utf8"));
    doc.set("status", "needs_review");
    doc.delete("reviewed");
    writeFileSync(file, doc.toString());
  }
}

export function prBody({ candidates, receipt, before = null, after = null, dropped = [] }) {
  const approved = receipt.questions.filter((q) => q.approved);
  const rejected = receipt.questions.filter((q) => !q.approved);
  const lines = ["## Replenish run", ""];
  lines.push(
    `Discovery: ${candidates.newPagesTotal} uncited pages in the indices, ${candidates.newPages.length} offered, ${candidates.drifted.length} drifted sources, ${candidates.gaps.length} gaps.`,
    "",
  );
  lines.push("### Sources", "");
  for (const p of candidates.newPages) lines.push(`- new: ${p.title} — ${p.url}`);
  for (const d of candidates.drifted)
    lines.push(`- re-captured: \`${d.id}\` [${d.classification}] ${d.summary || d.url}`);
  if (!candidates.newPages.length && !candidates.drifted.length) lines.push("- none");
  for (const d of dropped)
    lines.push(`- dropped selection ${JSON.stringify(d.row?.id ?? d.row)}: ${d.why.join("; ")}`);
  lines.push("", `### Review by \`${receipt.reviewer}\` (${receipt.reviewed_at})`, "");
  lines.push(`${approved.length} approved and promoted, ${rejected.length} rejected.`);
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
  return i !== -1 ? args[i + 1] : undefined;
}
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

async function main(argv) {
  const [cmd, ...args] = argv;
  if (cmd === "manifest") {
    const select = readJson(opt(args, "select"));
    const candidates = readJson(opt(args, "candidates"));
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
    if (rows.length) appendManifestRows(manifestFile, rows);
    writeFileSync("dropped.json", JSON.stringify(dropped, null, 2));
    for (const r of rows) console.log(captureLine(r));
    return;
  }
  if (cmd === "capture-args") {
    const candidates = readJson(opt(args, "candidates"));
    const sources = loadSources(CONTENT);
    for (const d of candidates.drifted) {
      const rec = sources.get(d.id);
      if (!rec) continue;
      console.log(
        captureLine({ id: rec.id, url: rec.url, title: rec.title, objectives: rec.objectives ?? [] }),
      );
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
      const text = await store.get(rec.snapshot?.key ?? rec.sha256);
      if (text === null) throw new Error(`${id}: snapshot ${rec.sha256} absent from the store`);
      writeFileSync(join("captured", `${id}.md`), text, "utf8");
      console.log(`staged captured/${id}.md`);
    }
    return;
  }
  if (cmd === "revalidation-ids") {
    const ids = (opt(args, "sources") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    console.log(revalidationIds({ sourceIds: ids }).join(" "));
    return;
  }
  if (cmd === "guard") {
    const base = opt(args, "base");
    const max = Number(opt(args, "max"));
    const out = execFileSync("git", ["diff", "--name-only", base, "--", "content/questions"], {
      encoding: "utf8",
    });
    const changed = out.split("\n").filter(Boolean);
    const statusAtBase = (file) => {
      try {
        const text = execFileSync("git", ["show", `${base}:${file}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        return parseYaml(text)?.status ?? null;
      } catch {
        return null;
      }
    };
    const problems = guardChanges({ changed, statusAtBase, max });
    for (const p of problems) console.error(`::error::${p}`);
    console.log(`${changed.length} question file(s) changed against ${base}`);
    if (problems.length) process.exit(1);
    return;
  }
  if (cmd === "demote") {
    demote(CONTENT, args);
    return;
  }
  if (cmd === "pr-body") {
    const body = prBody({
      candidates: readJson(opt(args, "candidates")),
      receipt: readJson(opt(args, "receipt")),
      before: opt(args, "before") ? readJson(opt(args, "before")) : null,
      after: opt(args, "after") ? readJson(opt(args, "after")) : null,
      dropped: existsSync("dropped.json") ? readJson("dropped.json") : [],
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
