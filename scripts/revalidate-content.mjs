#!/usr/bin/env node
/**
 * Complete Revalidation Lifecycle Script.
 *
 * Automates state transitions for questions in `status: needs_review`:
 *   needs_review@AAA -> revalidate against BBB -> repin source_sha256=BBB -> published
 *   needs_review@AAA -> excerpt missing in BBB -> review_ready (or retired)
 *
 * Usage:
 *   node scripts/revalidate-content.mjs
 *   node scripts/revalidate-content.mjs --retire-unmatched
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR ? resolve(process.env.ACADEMY_CONTENT_DIR) : join(ROOT, "content");

export const normalize = (str) =>
  str
    .normalize("NFC")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function loadYamlDir(contentDir, dir) {
  const p = join(contentDir, dir);
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => ({
      file: join(p, f),
      data: parseYaml(readFileSync(join(p, f), "utf8")),
    }));
}

/**
 * @param {object} opts
 * @param {string} [opts.contentDir]
 * @param {{get(key: string): Promise<string|null>}} opts.store
 * @param {boolean} [opts.retireUnmatched]
 * @returns {Promise<{revalidated: string[], unmatched: string[], totalProcessed: number}>}
 */
export async function revalidateContent({ contentDir = CONTENT, store, retireUnmatched = false }) {
  if (!store) {
    throw new Error("R2 snapshot store is required for revalidation.");
  }

  const sources = loadYamlDir(contentDir, "sources");
  const sourcesById = new Map(sources.map((s) => [s.data.id, s.data]));

  const questions = loadYamlDir(contentDir, "questions");
  const needsReview = questions.filter((q) => q.data?.status === "needs_review");

  const revalidated = [];
  const unmatched = [];
  const snapshotCache = new Map();

  async function getSnapshot(hashKey) {
    if (snapshotCache.has(hashKey)) return snapshotCache.get(hashKey);
    const text = await store.get(hashKey);
    snapshotCache.set(hashKey, text);
    return text;
  }

  for (const { file, data } of needsReview) {
    if (!data.evidence || data.evidence.length === 0) continue;

    let allExcerptsMatched = true;

    for (const ev of data.evidence) {
      const src = sourcesById.get(ev.source_id);
      if (!src) {
        allExcerptsMatched = false;
        break;
      }

      const latestHash = src.snapshot?.key || src.sha256;
      if (!latestHash) {
        allExcerptsMatched = false;
        break;
      }

      const snapshotText = await getSnapshot(latestHash);
      if (!snapshotText) {
        allExcerptsMatched = false;
        break;
      }

      if (normalize(snapshotText).includes(normalize(ev.excerpt))) {
        // Excerpt survived verbatim in latest snapshot BBB! Repin hash.
        ev.source_sha256 = latestHash;
      } else {
        // Excerpt missing or changed in snapshot BBB.
        allExcerptsMatched = false;
      }
    }

    if (allExcerptsMatched) {
      data.status = "published";
      revalidated.push(data.id);
    } else {
      data.status = retireUnmatched ? "retired" : "review_ready";
      unmatched.push(data.id);
    }

    writeFileSync(file, stringifyYaml(data));
  }

  return {
    revalidated,
    unmatched,
    totalProcessed: needsReview.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("Revalidation script loaded.");
}
