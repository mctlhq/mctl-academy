#!/usr/bin/env node
/**
 * Implements the second half of the drift lifecycle SOURCES.md documents:
 *
 *   1. source.yaml status -> drifted / deprecated       (source-drift.yml)
 *   2. dependent published questions -> needs_review     (this script)
 *   3. excluded from Practice/Mock selection             (checkBundleEligibility,
 *                                                          already correct: a
 *                                                          needs_review question
 *                                                          was never eligible)
 *   4. existing completed attempts untouched              (attempts are immutable
 *                                                          by construction; this
 *                                                          script never touches them)
 *
 * Before this script existed, step 1 ran but step 2 never did: a question
 * could sit at status: published while citing a drifted source. That is not
 * merely stale -- validate-content.mjs treats it as invalid (`cannot be
 * published: source ... is drifted`), so the very rebuild meant to enforce
 * fail-closed quarantine left content/ in a state its own lint would reject.
 * Discovered 2026-08-18 when a manually-dispatched drift run produced exactly
 * that state (see #198).
 *
 * Usage:
 *   node scripts/quarantine-drifted-questions.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(ROOT, "content");

const UNUSABLE_SOURCE_STATUSES = new Set(["drifted", "deprecated"]);

function loadYamlDir(contentDir, dir) {
  const p = join(contentDir, dir);
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => ({
      file: join(p, f),
      doc: parseDocument(readFileSync(join(p, f), "utf8")),
    }));
}

/**
 * @param {object} opts
 * @param {string} [opts.contentDir]
 * @returns {{quarantined: string[], alreadyHandled: string[], totalPublished: number}}
 */
export function quarantineDriftedQuestions({ contentDir = CONTENT } = {}) {
  const sources = loadYamlDir(contentDir, "sources");
  const unusableSourceIds = new Set(
    sources.filter((s) => UNUSABLE_SOURCE_STATUSES.has(s.doc.toJS()?.status)).map((s) => s.doc.toJS().id),
  );

  const questions = loadYamlDir(contentDir, "questions");
  const published = questions.filter((q) => q.doc.toJS()?.status === "published");

  const quarantined = [];
  const alreadyHandled = [];

  for (const { file, doc } of published) {
    const data = doc.toJS();
    const citesUnusable = (data.evidence ?? []).some((ev) => unusableSourceIds.has(ev.source_id));
    if (!citesUnusable) continue;

    // published -> needs_review, never published -> anything else. A question
    // already reviewed once carries that history; needs_review is exactly
    // the state that says "was published, needs re-verification" as opposed
    // to draft's "never published at all" -- CONTENT-POLICY.md's own
    // distinction, restated in scripts/validate-content.mjs's comments.
    doc.set("status", "needs_review");
    writeFileSync(file, doc.toString(), "utf8");
    quarantined.push(data.id ?? file);
  }

  for (const { doc } of questions) {
    const data = doc.toJS();
    if (data?.status !== "needs_review") continue;
    const citesUnusable = (data.evidence ?? []).some((ev) => unusableSourceIds.has(ev.source_id));
    if (citesUnusable) alreadyHandled.push(data.id);
  }

  return { quarantined, alreadyHandled, totalPublished: published.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { quarantined } = quarantineDriftedQuestions({});
  if (quarantined.length) {
    console.log(`quarantined ${quarantined.length} question(s): ${quarantined.join(", ")}`);
  } else {
    console.log("no published questions cite a drifted or deprecated source");
  }
}
