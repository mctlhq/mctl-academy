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
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR ? resolve(process.env.ACADEMY_CONTENT_DIR) : join(ROOT, "content");
const QUESTIONS_DIR = join(CONTENT, "questions");

function parseArgs(args) {
  let by = process.env.MAINTAINER_HANDLE || process.env.GITHUB_USER || process.env.USER || null;
  let allReviewReady = false;
  let courseId = null;
  const idsOrPaths = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--by" && i + 1 < args.length) {
      by = args[++i];
    } else if (arg === "--all-review-ready") {
      allReviewReady = true;
    } else if (arg === "--course" && i + 1 < args.length) {
      courseId = args[++i];
    } else if (!arg.startsWith("-")) {
      idsOrPaths.push(arg);
    }
  }

  return { by, allReviewReady, courseId, idsOrPaths };
}

export function promoteQuestions({ contentDir = CONTENT, by, allReviewReady = false, courseId = null, idsOrPaths = [] }) {
  const qDir = join(contentDir, "questions");
  if (!existsSync(qDir)) {
    throw new Error(`Questions directory not found at ${qDir}`);
  }

  if (!by) {
    throw new Error("Maintainer handle required. Pass --by <handle> or set GITHUB_USER / MAINTAINER_HANDLE.");
  }

  const filesToProcess = [];

  if (allReviewReady || courseId) {
    const files = readdirSync(qDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const f of files) {
      const p = join(qDir, f);
      const data = parseYaml(readFileSync(p, "utf8"));
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

  const now = new Date().toISOString();
  const promoted = [];

  for (const filePath of filesToProcess) {
    const raw = readFileSync(filePath, "utf8");
    const data = parseYaml(raw);

    if (data.status !== "review_ready" && data.status !== "draft") {
      throw new Error(
        `Question ${data.id} in ${filePath} has status "${data.status}". ` +
          'Only items in "review_ready" or "draft" can be promoted to "published".',
      );
    }

    if (!data.authored || !data.authored.by || !data.authored.by.startsWith("agent:")) {
      throw new Error(
        `Question ${data.id} in ${filePath} must have an agent author (authored.by: agent:<name>). ` +
          "Clean-room separation: humans approve in reviewed, agents author in authored.",
      );
    }

    data.status = "published";
    data.reviewed = {
      by,
      at: now,
    };

    writeFileSync(filePath, stringifyYaml(data));
    promoted.push(data.id);
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
