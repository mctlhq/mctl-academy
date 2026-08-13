#!/usr/bin/env node
/**
 * Complete Revalidation Lifecycle Script.
 *
 * Automates state transitions for questions in `status: needs_review`:
 *   needs_review@AAA -> revalidate against BBB -> repin source_sha256=BBB -> review_ready
 *   needs_review@AAA -> excerpt missing in BBB -> review_ready
 *
 * Usage:
 *   node scripts/revalidate-content.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, isSeq, isMap } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(ROOT, "content");

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
      doc: parseDocument(readFileSync(join(p, f), "utf8")),
    }));
}

/**
 * @param {object} opts
 * @param {string} [opts.contentDir]
 * @param {{get(key: string): Promise<string|null>}} opts.store
 * @returns {Promise<{revalidated: string[], unmatched: string[], errors: string[], totalProcessed: number}>}
 */
export async function revalidateContent({ contentDir = CONTENT, store }) {
  if (!store) {
    throw new Error("R2 snapshot store is required for revalidation.");
  }

  const sources = loadYamlDir(contentDir, "sources");
  const sourcesById = new Map();
  for (const s of sources) {
    const data = s.doc.toJS();
    if (data?.id) sourcesById.set(data.id, data);
  }

  const questions = loadYamlDir(contentDir, "questions");
  const needsReview = questions.filter((q) => q.doc.toJS()?.status === "needs_review");

  const revalidated = [];
  const unmatched = [];
  const errors = [];
  const snapshotCache = new Map();

  async function getSnapshot(hashKey, sourceId) {
    if (snapshotCache.has(hashKey)) return snapshotCache.get(hashKey);
    try {
      const text = await store.get(hashKey);
      snapshotCache.set(hashKey, text);
      return text;
    } catch (err) {
      errors.push(`R2 error fetching snapshot ${hashKey} for ${sourceId}: ${err.message}`);
      snapshotCache.set(hashKey, null);
      return null;
    }
  }

  for (const { file, doc } of needsReview) {
    const data = doc.toJS();
    if (!data.evidence || data.evidence.length === 0) continue;

    let allExcerptsMatched = true;
    const proposedRepins = [];

    for (let idx = 0; idx < data.evidence.length; idx++) {
      const ev = data.evidence[idx];
      const src = sourcesById.get(ev.source_id);
      if (!src) {
        allExcerptsMatched = false;
        errors.push(`Question ${data.id || file} cites unknown source ${ev.source_id}`);
        break;
      }

      const latestHash = src.snapshot?.key || src.sha256;
      if (!latestHash) {
        allExcerptsMatched = false;
        errors.push(`Source ${ev.source_id} has no valid sha256 or snapshot key`);
        break;
      }

      const snapshotText = await getSnapshot(latestHash, ev.source_id);
      if (!snapshotText) {
        allExcerptsMatched = false;
        break;
      }

      if (normalize(snapshotText).includes(normalize(ev.excerpt))) {
        proposedRepins.push({ idx, hash: latestHash });
      } else {
        allExcerptsMatched = false;
      }
    }

    if (allExcerptsMatched && proposedRepins.length === data.evidence.length) {
      // Atomic repinning: update evidence hashes ONLY when ALL evidence items match
      // isSeq/isMap rather than duck-typing on `.get`/`.set`: yaml's own type
      // guards say what these nodes have to be for the write to mean
      // anything, and a scalar or an alias would answer the duck-type check
      // while silently not being the sequence of evidence maps this is
      // repinning.
      const evidenceNode = doc.get("evidence");
      if (isSeq(evidenceNode)) {
        for (const { idx, hash } of proposedRepins) {
          const itemNode = evidenceNode.get(idx);
          if (isMap(itemNode)) {
            itemNode.set("source_sha256", hash);
          }
        }
      }
      doc.set("status", "review_ready");
      revalidated.push(data.id);
    } else {
      doc.set("status", "review_ready");
      unmatched.push(data.id);
    }

    writeFileSync(file, doc.toString(), "utf8");
  }

  return {
    revalidated,
    unmatched,
    errors,
    totalProcessed: needsReview.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("Revalidation script loaded.");
}
