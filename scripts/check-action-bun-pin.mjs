#!/usr/bin/env node
/**
 * Fails when content-replenish.yml's setup-bun pin differs from the bun
 * version that the pinned anthropics/claude-code-action installs under it.
 *
 * The action runs its own oven-sh/setup-bun inside every agent step. When the
 * two versions differ, that copy downloads mid-step, ~/.bun/bin/bun changes
 * under the manifest the workflow hashed before the agent ran, and the
 * trusted-file guard fails the run. tests/replenish-prepare.test.mjs keeps
 * the pins consistent with the `# vX (CLI Y, bun Z)` comment beside each
 * action pin, but that comment is prose: Dependabot moved the SHA to v1.0.268
 * (bun 1.4.4) in #434 and left it reading "bun 1.3.14", the test stayed
 * green, and replenish run 43656589672 failed. This check reads the version
 * from the action's own action.yml at the pinned SHA instead, so a one-sided
 * bump fails on its own PR.
 *
 * Fail closed: an action.yml that cannot be fetched, a non-200 answer, or a
 * file with no recognisable setup-bun version is a problem, never a pass.
 *
 * Usage: node scripts/check-action-bun-pin.mjs [workflow-path]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WORKFLOW = fileURLToPath(new URL("../.github/workflows/content-replenish.yml", import.meta.url));
const ACTION = "anthropics/claude-code-action";
const SHA = /^[0-9a-f]{40}$/;

/**
 * The workflow's own setup-bun versions and the distinct action SHAs it pins.
 * @param {string} text
 */
export function workflowPins(text) {
  const bun = [...text.matchAll(/^\s*bun-version:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const shas = [
    ...new Set([...text.matchAll(/uses:\s*anthropics\/claude-code-action@(\S+)/g)].map((m) => m[1])),
  ];
  return { bun, shas };
}

/**
 * The bun version the action's setup-bun step installs, or null when the file
 * has no such step. Only a `bun-version:` inside the step that uses
 * oven-sh/setup-bun counts, so an unrelated key elsewhere cannot satisfy it.
 * @param {string} actionYml
 */
export function embeddedBunVersion(actionYml) {
  const lines = actionYml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/uses:\s*oven-sh\/setup-bun@/.test(lines[i])) continue;
    const indent = lines[i].match(/^\s*/)[0].length;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() === "" || line.trim().startsWith("#")) continue;
      const own = line.match(/^\s*/)[0].length;
      // A new step ("- ...") at or left of `uses:`'s column ends this one.
      if (own < indent || (own <= indent && line.trim().startsWith("-"))) break;
      const m = line.match(/^\s*bun-version:\s*["']?([^"'\s#]+)/);
      if (m) return m[1];
    }
  }
  return null;
}

/**
 * Every problem, given a fetcher `(sha) => Promise<string>` that returns the
 * action.yml text or throws.
 * @param {string} text
 * @param {(sha: string) => Promise<string>} fetchActionYml
 * @returns {Promise<string[]>}
 */
export async function check(text, fetchActionYml) {
  const { bun, shas } = workflowPins(text);
  const problems = [];
  if (bun.length === 0) problems.push("the workflow has no setup-bun `bun-version:`");
  if (new Set(bun).size > 1) problems.push(`the workflow's setup-bun steps disagree: ${bun.join(", ")}`);
  if (shas.length === 0) problems.push(`the workflow pins no ${ACTION}`);
  for (const sha of shas) {
    if (!SHA.test(sha)) {
      problems.push(`${ACTION}@${sha} is not a full commit SHA`);
      continue;
    }
    let yml;
    try {
      yml = await fetchActionYml(sha);
    } catch (err) {
      problems.push(`could not read ${ACTION}@${sha}/action.yml: ${err.message}`);
      continue;
    }
    const embedded = embeddedBunVersion(yml);
    if (embedded === null) {
      problems.push(`${ACTION}@${sha}/action.yml has no oven-sh/setup-bun step with a bun-version`);
    } else if (bun.length > 0 && embedded !== bun[0]) {
      problems.push(
        `setup-bun installs ${bun[0]} but ${ACTION}@${sha.slice(0, 7)} installs bun ${embedded}; ` +
          "move every `bun-version:` in content-replenish.yml (and the pin comments) to match",
      );
    }
  }
  return problems;
}

/** @param {string} sha */
async function fetchFromGitHub(sha) {
  const url = `https://raw.githubusercontent.com/${ACTION}/${sha}/action.yml`;
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.status !== 200) throw new Error(`HTTP ${res.status} from ${url}`);
      return await res.text();
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = process.argv[2] ?? WORKFLOW;
  const problems = await check(readFileSync(path, "utf8"), fetchFromGitHub);
  if (problems.length > 0) {
    for (const p of problems) console.error(`check-action-bun-pin: ${p}`);
    process.exit(1);
  }
  console.log("check-action-bun-pin: setup-bun matches the bun the agent action installs");
}
