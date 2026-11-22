#!/usr/bin/env node
/**
 * Opens or updates ONE umbrella intake issue per drift run (per ISO week).
 *
 * Until 2026-11-22 this opened one `drift: <source-id>` issue per drifted
 * source: 26 open issues one week, 46 the next, for what is a single weekly
 * event with a single quarantine PR. The per-source path is deleted, not
 * left dormant; old per-source issues are closed by hand.
 *
 * Input is the report `snapshot:capture -- --check --mark-drifted` prints:
 *
 *   ok       src-example
 *   DRIFTED  src-example  <old12> -> <new12>  https://docs.example/page.md
 *
 * Dedup key is the exact title `drift: sources changed <YYYY-Www>`, and the
 * body carries a hidden marker comment. A re-run in the same week finds that
 * issue and REPLACES its body (never appends), so the issue always reflects
 * the latest run. Listing existing issues or the quarantine PR is a read that
 * must succeed: a failed or malformed read throws, because "could not list"
 * must never be treated as "no issue exists" (that would open a duplicate).
 *
 * Usage:
 *   node scripts/drift-intake.mjs --report drift.txt --repo owner/repo [--label name ...]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_LABELS = ["content:drift"];

export const QUARANTINE_BRANCH = "chore/quarantine-drift";

/** GitHub rejects issue bodies over 65536 characters; stay well under it. */
export const MAX_BODY_CHARS = 60000;

/** ISO 8601 week label, e.g. `2026-W48`, computed in UTC. */
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function umbrellaTitle(week) {
  return `drift: sources changed ${week}`;
}

export function umbrellaMarker(week) {
  return `<!-- source-drift-umbrella:${week} -->`;
}

/**
 * One unreadable line costs that line, not the other rows' issues; the
 * caller reports `errors` and exits non-zero after every good row is handled.
 *
 * @returns {{ rows: { id: string, oldHash: string, newHash: string, url: string, movedTo?: string }[], errors: string[] }}
 */
export function parseDriftReport(text) {
  const rows = [];
  const errors = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("DRIFTED")) continue;
    const parts = line.split(/\s+/);
    // DRIFTED <id> <old> -> <new> <url>
    if (parts.length < 6 || parts[3] !== "->") {
      errors.push(`unparseable DRIFTED line: ${JSON.stringify(raw)}`);
      continue;
    }
    /** @type {{ id: string, oldHash: string, newHash: string, url: string, movedTo?: string }} */
    const row = { id: parts[1], oldHash: parts[2], newHash: parts[4], url: parts[5] };
    // checkSources() appends `moved-to <url>` to a gone row when the page was
    // redirected to a different one rather than answering 404/410.
    if (parts[6] === "moved-to" && parts[7]) row.movedTo = parts[7];
    rows.push(row);
  }
  return { rows, errors };
}

function rowLine(row) {
  if (row.newHash === "gone") {
    const state = row.movedTo ? `moved to ${row.movedTo}` : "gone (404/410), marked deprecated";
    return `- \`${row.id}\` - ${row.url} - ${state}`;
  }
  return `- \`${row.id}\` - ${row.url} (\`${row.oldHash}\` -> \`${row.newHash}\`)`;
}

/**
 * Body of the umbrella issue. Lists every drifted source until the size
 * budget is reached, then states how many were left out; never truncates
 * silently.
 *
 * @param {{ week: string, rows: object[], prUrl?: string | null, runUrl?: string | null, maxChars?: number }} args
 */
export function umbrellaBody({ week, rows, prUrl = null, runUrl = null, maxChars = MAX_BODY_CHARS }) {
  const head = [
    umbrellaMarker(week),
    `Upstream sources changed in ${week}: ${rows.length} source${rows.length === 1 ? "" : "s"} marked \`drifted\` or \`deprecated\` (fail-closed quarantine).`,
    "",
    prUrl
      ? `Quarantine pull request: ${prUrl}`
      : `Quarantine pull request: none open on \`${QUARANTINE_BRANCH}\` (see the workflow run).`,
    ...(runUrl ? [`Workflow run: ${runUrl}`] : []),
    "",
    "Questions citing these sources are excluded from learner selection once the quarantine PR is merged. The next Content replenish run re-captures the pages. The drift check skips deprecated sources, so a deprecated one is restored by hand (`status: current`) after re-checking its hash if the URL resolves again. See SOURCES.md and CONTENT-POLICY.md.",
    "",
    "Drifted sources:",
    "",
  ].join("\n");
  const lines = rows.map(rowLine);
  // Reserve room for the "and N more" line so it always fits.
  const reserve = 80;
  let used = head.length + reserve;
  let shown = 0;
  for (const line of lines) {
    if (used + line.length + 1 > maxChars) break;
    used += line.length + 1;
    shown += 1;
  }
  const out = [head + lines.slice(0, shown).join("\n")];
  if (shown < lines.length) {
    out.push(
      `\n\n...and ${lines.length - shown} more (list truncated at the issue size limit; see drift.txt in the workflow run).`,
    );
  }
  return out.join("");
}

/** Default runner: `gh` with the given argv, returning stdout as text. */
export function runGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

/**
 * Number of the issue whose title is exactly `title` (open or closed, so a
 * same-week re-run after a manual close updates it instead of duplicating),
 * or null when the listing succeeded and there is none. A gh failure, a
 * malformed body, or a full page (the match could be past it) throws.
 */
export function findExistingIssue({ repo, title, gh = runGh }) {
  const out = gh([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--search",
    `"${title}" in:title`,
    "--json",
    "number,title",
    "--limit",
    String(LIST_LIMIT),
  ]);
  let issues;
  try {
    issues = JSON.parse(out);
  } catch (err) {
    throw new Error(`could not parse issue listing: ${err.message}`);
  }
  if (!Array.isArray(issues)) throw new Error("issue listing is not an array");
  if (issues.length >= LIST_LIMIT) {
    throw new Error(`issue listing hit the ${LIST_LIMIT} limit; cannot prove no umbrella issue exists`);
  }
  // The search is a substring match; the decision is an exact one.
  const hit = issues.find((issue) => issue.title === title);
  return hit ? hit.number : null;
}

const LIST_LIMIT = 100;

/** URL of the open quarantine PR, or null when the listing succeeded and there is none. */
export function findQuarantinePr({ repo, gh = runGh }) {
  const out = gh([
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--head",
    QUARANTINE_BRANCH,
    "--json",
    "url",
    "--limit",
    "10",
  ]);
  let prs;
  try {
    prs = JSON.parse(out);
  } catch (err) {
    throw new Error(`could not parse PR listing: ${err.message}`);
  }
  if (!Array.isArray(prs)) throw new Error("PR listing is not an array");
  return prs.length ? prs[0].url : null;
}

export const LABEL_DEFINITIONS = {
  "content:drift": {
    description: "Upstream documentation drift detected by the Source drift workflow",
    color: "D93F0B",
  },
  "agents:quarantine": {
    description: "Fail-closed quarantine of drifted sources, opened by the Source drift workflow",
    color: "B60205",
  },
};

export function ensureLabels({ repo, labels, gh = runGh }) {
  for (const label of labels) {
    // `--force` updates an existing label instead of failing, so this is
    // idempotent; a label that cannot be created must not sink the run, the
    // issue is still worth opening without it (see addLabels below).
    const def = LABEL_DEFINITIONS[label] ?? { description: "", color: "EDEDED" };
    try {
      gh([
        "label",
        "create",
        label,
        "--repo",
        repo,
        "--force",
        "--description",
        def.description,
        "--color",
        def.color,
      ]);
    } catch (err) {
      console.warn(`::warning::could not ensure label ${label}: ${err.message}`);
    }
  }
}

/** Labels are applied after creation, one at a time, each failure tolerated. */
function addLabels({ repo, issue, labels, gh }) {
  for (const label of labels) {
    try {
      gh(["issue", "edit", String(issue), "--repo", repo, "--add-label", label]);
    } catch (err) {
      console.warn(`::warning::could not add label ${label} to ${issue}: ${err.message}`);
    }
  }
}

/**
 * Opens or updates the week's umbrella issue. Throws when any read fails, so
 * the workflow step goes red instead of opening a second issue.
 *
 * @returns {{ action: "created" | "updated" | "none", issue: number | string, title: string }}
 */
export function syncUmbrellaIssue({
  rows,
  repo,
  labels = DEFAULT_LABELS,
  gh = runGh,
  now = new Date(),
  runUrl = null,
}) {
  if (!rows.length) return { action: "none", issue: "", title: "" };
  const week = isoWeek(now);
  const title = umbrellaTitle(week);
  const existing = findExistingIssue({ repo, title, gh });
  const prUrl = findQuarantinePr({ repo, gh });
  const body = umbrellaBody({ week, rows, prUrl, runUrl });
  if (existing !== null) {
    gh(["issue", "edit", String(existing), "--repo", repo, "--body", body]);
    addLabels({ repo, issue: existing, labels, gh });
    return { action: "updated", issue: existing, title };
  }
  // Create first, label after: `gh issue create --label` fails outright on a
  // label that does not exist, and the issue matters more than it.
  const url = gh(["issue", "create", "--repo", repo, "--title", title, "--body", body]).trim();
  addLabels({ repo, issue: url, labels, gh });
  return { action: "created", issue: url, title };
}

function parseArgs(argv) {
  const opts = { report: null, repo: null, labels: [], ensureLabelsOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--report") opts.report = argv[++i];
    else if (arg === "--repo") opts.repo = argv[++i];
    else if (arg === "--label") opts.labels.push(argv[++i]);
    else if (arg === "--ensure-labels-only") opts.ensureLabelsOnly = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!opts.repo || (!opts.report && !opts.ensureLabelsOnly)) {
    throw new Error(
      "usage: drift-intake.mjs --repo <owner/repo> (--report <file> | --ensure-labels-only) [--label <name>]",
    );
  }
  if (!opts.labels.length) opts.labels = DEFAULT_LABELS;
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    ensureLabels({
      repo: opts.repo,
      labels: opts.ensureLabelsOnly ? Object.keys(LABEL_DEFINITIONS) : opts.labels,
    });
    if (opts.ensureLabelsOnly) process.exit(0);
    const { rows, errors } = parseDriftReport(readFileSync(opts.report, "utf8"));
    for (const e of errors) console.error(`::error::${e}`);
    if (!rows.length) {
      console.log("no DRIFTED rows in the report; nothing to open");
      process.exit(errors.length ? 1 : 0);
    }
    const result = syncUmbrellaIssue({
      rows,
      repo: opts.repo,
      labels: opts.labels,
      runUrl: process.env.RUN_URL || null,
    });
    console.log(`${result.action}\t${result.title}\t${result.issue}`);
    if (errors.length) process.exit(1);
  } catch (err) {
    console.error(`drift-intake: ${err.message}`);
    process.exit(1);
  }
}
