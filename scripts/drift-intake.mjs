#!/usr/bin/env node
/**
 * Opens or updates the `drift: <source-id>` intake issues after a drift run.
 *
 * This used to be an inline bash loop in source-drift.yml. It never worked:
 * the dedup lookup was written as `gh issue list --jq --arg title ...`, and
 * `gh --jq` takes exactly one expression, so every scheduled run since the
 * first one died with `unknown arguments ["title" ...]` before a single issue
 * existed. Moving the logic here makes the parsing and the dedup decision
 * testable with a stubbed `gh`, which the shell version could not be.
 *
 * Input is the report `snapshot:capture -- --check --mark-drifted` prints:
 *
 *   ok       src-example
 *   DRIFTED  src-example  <old12> -> <new12>  https://docs.example/page.md
 *
 * Dedup key is the exact issue title. A source that stays drifted for a month
 * gets one issue with a comment per run, never four identical issues.
 *
 * Usage:
 *   node scripts/drift-intake.mjs --report drift.txt --repo owner/repo [--label name ...]
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_LABELS = ["content:drift"];

export function issueTitle(id) {
  return `drift: ${id}`;
}

/** @returns {{ id: string, oldHash: string, newHash: string, url: string }[]} */
export function parseDriftReport(text) {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("DRIFTED")) continue;
    const parts = line.split(/\s+/);
    // DRIFTED <id> <old> -> <new> <url>
    if (parts.length < 6 || parts[3] !== "->") {
      throw new Error(`unparseable DRIFTED line: ${JSON.stringify(raw)}`);
    }
    rows.push({ id: parts[1], oldHash: parts[2], newHash: parts[4], url: parts[5] });
  }
  return rows;
}

export function issueBody({ id, url, oldHash, newHash }) {
  return [
    "Upstream source changed. Automatically marked `status: drifted` (fail-closed quarantine).",
    "",
    `- source: \`${id}\``,
    `- url: ${url}`,
    `- recorded hash: \`${oldHash}\``,
    `- current hash: \`${newHash}\``,
    "",
    "Questions citing this source are excluded from learner selection until re-verified.",
    "The quarantine itself lands through the `chore/quarantine-drift` pull request.",
    "Re-capture with:",
    "",
    "```",
    `npm run snapshot:capture -- ${url} --id ${id} --objective <objective>`,
    "```",
    "",
    "See SOURCES.md and CONTENT-POLICY.md.",
  ].join("\n");
}

/** Default runner: `gh` with the given argv, returning stdout as text. */
export function runGh(args) {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

export function findExistingIssue({ repo, title, gh = runGh }) {
  const out = gh([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--search",
    `"${title}" in:title`,
    "--json",
    "number,title",
  ]);
  const issues = out.trim() ? JSON.parse(out) : [];
  // The search is a substring match; the decision is an exact one.
  const hit = issues.find((issue) => issue.title === title);
  return hit ? hit.number : null;
}

export function ensureLabels({ repo, labels, gh = runGh }) {
  for (const label of labels) {
    // `--force` updates an existing label instead of failing, so this is
    // idempotent; a label that cannot be created must not sink the run, the
    // issue is still worth opening without it.
    try {
      gh([
        "label",
        "create",
        label,
        "--repo",
        repo,
        "--force",
        "--description",
        "Upstream documentation drift detected by the Source drift workflow",
        "--color",
        "D93F0B",
      ]);
    } catch (err) {
      console.warn(`::warning::could not ensure label ${label}: ${err.message}`);
    }
  }
}

/**
 * @returns {{ id: string, action: "commented" | "created", issue: number | string }[]}
 */
export function syncDriftIssues({ rows, repo, labels = DEFAULT_LABELS, gh = runGh }) {
  /** @type {{ id: string, action: "commented" | "created", issue: number | string }[]} */
  const actions = [];
  for (const row of rows) {
    const title = issueTitle(row.id);
    const body = issueBody(row);
    const existing = findExistingIssue({ repo, title, gh });
    if (existing !== null) {
      gh(["issue", "comment", String(existing), "--repo", repo, "--body", body]);
      actions.push({ id: row.id, action: "commented", issue: existing });
      continue;
    }
    const args = ["issue", "create", "--repo", repo, "--title", title, "--body", body];
    for (const label of labels) args.push("--label", label);
    const url = gh(args).trim();
    actions.push({ id: row.id, action: "created", issue: url });
  }
  return actions;
}

function parseArgs(argv) {
  const opts = { report: null, repo: null, labels: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--report") opts.report = argv[++i];
    else if (arg === "--repo") opts.repo = argv[++i];
    else if (arg === "--label") opts.labels.push(argv[++i]);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!opts.report || !opts.repo) {
    throw new Error("usage: drift-intake.mjs --report <file> --repo <owner/repo> [--label <name>]");
  }
  if (!opts.labels.length) opts.labels = DEFAULT_LABELS;
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const rows = parseDriftReport(readFileSync(opts.report, "utf8"));
    if (!rows.length) {
      console.log("no DRIFTED rows in the report; nothing to open");
      process.exit(0);
    }
    ensureLabels({ repo: opts.repo, labels: opts.labels });
    for (const a of syncDriftIssues({ rows, repo: opts.repo, labels: opts.labels })) {
      console.log(`${a.action}\t${a.id}\t${a.issue}`);
    }
  } catch (err) {
    console.error(`drift-intake: ${err.message}`);
    process.exit(1);
  }
}
