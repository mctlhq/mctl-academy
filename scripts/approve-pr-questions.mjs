#!/usr/bin/env node
/**
 * Maintainer promotion CLI tool.
 *
 * Promotes agent-authored questions from `status: review_ready` to `status: published`.
 * Stamps `reviewed: { by: maintainer, at: ISO-timestamp }` after validating clean-room rules.
 *
 * Usage:
 *   node scripts/approve-pr-questions.mjs --by mashkovd q-bc01b0c1d2e3 q-bc02c1d2e3f4
 *   node scripts/approve-pr-questions.mjs --all-review-ready --by mashkovd
 *   node scripts/approve-pr-questions.mjs --course agentic-ai-builder --by mashkovd
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { AGENT_ID, questionFingerprint, reviewProblems } from "./lib/question-review.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(ROOT, "content");

export function parseArgs(args) {
  let by = process.env.MAINTAINER_HANDLE || process.env.GITHUB_USER || process.env.USER || null;
  let allReviewReady = false;
  let courseId = null;
  let reviewFile = null;
  const idsOrPaths = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--by" && i + 1 < args.length) {
      by = args[++i];
    } else if (arg === "--review-file" && i + 1 < args.length) {
      reviewFile = args[++i];
    } else if (arg === "--all-review-ready") {
      allReviewReady = true;
    } else if (arg === "--course" && i + 1 < args.length) {
      courseId = args[++i];
    } else if (!arg.startsWith("-")) {
      idsOrPaths.push(arg);
    }
  }

  const modesCount = [allReviewReady, !!courseId, idsOrPaths.length > 0].filter(Boolean).length;
  if (modesCount > 1) {
    throw new Error(
      "Selection modes (--all-review-ready, --course, and explicit IDs/paths) are mutually exclusive. Specify only one mode.",
    );
  }

  return { by, allReviewReady, courseId, idsOrPaths, reviewFile };
}

export function promoteQuestions({
  contentDir = CONTENT,
  by,
  allReviewReady = false,
  courseId = null,
  idsOrPaths = [],
  reviewFile = null,
}) {
  const qDir = join(contentDir, "questions");
  if (!existsSync(qDir)) {
    throw new Error(`Questions directory not found at ${qDir}`);
  }

  if (!by || typeof by !== "string" || by.trim() === "") {
    throw new Error("Maintainer handle required. Pass --by <handle> or set GITHUB_USER / MAINTAINER_HANDLE.");
  }

  const handle = by.trim();
  if (handle.startsWith("agent:") && !AGENT_ID.test(handle)) {
    throw new Error(`Invalid agent reviewer identifier "${handle}".`);
  }

  if (handle.startsWith("agent:") && (allReviewReady || courseId)) {
    throw new Error("Agent approval requires explicit reviewed question IDs, not a whole course or bank.");
  }
  let receipt = null;
  if (handle.startsWith("agent:")) {
    if (!reviewFile) throw new Error("Agent approval requires --review-file from the independent reviewer.");
    receipt = JSON.parse(readFileSync(reviewFile, "utf8"));
    if (receipt.reviewer !== handle || !Array.isArray(receipt.questions)) {
      throw new Error("Review file must identify the reviewer and reviewed questions.");
    }
  }

  const modesCount = [allReviewReady, !!courseId, idsOrPaths.length > 0].filter(Boolean).length;
  if (modesCount > 1) {
    throw new Error(
      "Selection modes (allReviewReady, courseId, idsOrPaths) are mutually exclusive. Specify only one mode.",
    );
  }

  const filesToProcess = [];

  if (allReviewReady || courseId) {
    const files = readdirSync(qDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const f of files) {
      const p = join(qDir, f);
      const doc = parseDocument(readFileSync(p, "utf8"));
      const data = doc.toJS();
      if (data?.status === "review_ready") {
        if (!courseId || data.course_id === courseId) {
          filesToProcess.push(p);
        }
      }
    }
  } else {
    for (const item of idsOrPaths) {
      let p = item;
      if (!existsSync(p)) {
        const withYaml = item.endsWith(".yaml") ? item : `${item}.yaml`;
        p = join(qDir, withYaml);
      }
      if (!existsSync(p)) {
        throw new Error(`Question file or ID not found: ${item}`);
      }
      filesToProcess.push(p);
    }
  }

  if (filesToProcess.length === 0) {
    return { promoted: [], count: 0 };
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const preparedMutations = [];

  // Phase 1: Load and validate ALL target files in memory before modifying disk
  for (const filePath of filesToProcess) {
    const raw = readFileSync(filePath, "utf8");
    const doc = parseDocument(raw);
    const data = doc.toJS();

    if (!data || typeof data !== "object") {
      throw new Error(`Invalid YAML object in ${filePath}`);
    }

    if (data.status !== "review_ready") {
      throw new Error(
        `Question ${data.id || filePath} in ${filePath} has status "${data.status}". ` +
          'Only items in "review_ready" can be promoted to "published".',
      );
    }

    if (!data.authored || !data.authored.by || !data.authored.by.startsWith("agent:")) {
      throw new Error(
        `Question ${data.id || filePath} in ${filePath} must have an agent author (authored.by: agent:<name>). ` +
          "Clean-room separation: humans approve in reviewed, agents author in authored.",
      );
    }

    if (receipt) {
      const decisions = receipt.questions.filter((item) => item.id === data.id);
      if (
        decisions.length !== 1 ||
        decisions[0].approved !== true ||
        decisions[0].content_sha256 !== questionFingerprint(data)
      ) {
        throw new Error(`${data.id}: missing approval or stale fingerprint in independent review file`);
      }
    }
    // Every approval binds to the exact revision it was granted for, human or
    // agent: a later edit to any question material makes the fingerprint stale
    // and withdraws the item from the bundle until it is reviewed again.
    const reviewed = { by: handle, at: now, content_sha256: questionFingerprint(data) };
    const problems = reviewProblems({ ...data, reviewed });
    if (problems.length) throw new Error(`${data.id}: ${problems.join("; ")}`);
    doc.set("status", "published");
    doc.set("reviewed", reviewed);

    preparedMutations.push({
      filePath,
      id: data.id,
      content: doc.toString(),
    });
  }

  // Phase 2: All items passed validation. Perform atomic disk writes.
  const promoted = [];
  for (const item of preparedMutations) {
    writeFileSync(item.filePath, item.content, "utf8");
    promoted.push(item.id);
  }

  return { promoted, count: promoted.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const result = promoteQuestions(opts);
    console.log(`Successfully promoted ${result.count} question(s) to status: published.`);
    if (result.promoted.length > 0) {
      console.log(`Promoted IDs: ${result.promoted.join(", ")}`);
    }
  } catch (err) {
    console.error(`Promotion failed: ${err.message}`);
    process.exit(1);
  }
}
