#!/usr/bin/env node
/**
 * Complete Revalidation Lifecycle Script.
 *
 * Automates state transitions for questions in `status: needs_review`:
 *   needs_review@AAA -> revalidate against BBB -> repin source_sha256=BBB -> review_ready
 *   needs_review@AAA -> excerpt missing in BBB -> needs_review (unchanged)
 *
 * Usage:
 *   node scripts/revalidate-content.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, isSeq, isMap } from "yaml";
import { storeFromEnv } from "./lib/snapshot-store.mjs";
import { normalize } from "./verify-evidence.mjs";
export { normalize } from "./verify-evidence.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(ROOT, "content");

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
 * @param {string[]} [opts.ids]
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{revalidated: string[], unmatched: string[], errors: string[], totalProcessed: number}>}
 */
export async function revalidateContent({ contentDir = CONTENT, store, ids = [], dryRun = false }) {
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
  if (!ids.length)
    throw new Error("Select explicit question IDs; revalidation never processes the whole bank implicitly.");
  const selected = new Set(ids);
  const needsReview = questions.filter((q) => selected.has(q.doc.toJS()?.id));
  for (const id of selected) {
    const item = needsReview.find((q) => q.doc.toJS()?.id === id)?.doc.toJS();
    if (!item || item.status !== "needs_review")
      throw new Error(`${id}: expected an existing needs_review question`);
  }

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
    if (!data.evidence || data.evidence.length === 0) {
      unmatched.push(data.id);
      errors.push(`${data.id}: no evidence`);
      continue;
    }

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
      if (src.status === "drifted" || src.status === "deprecated") {
        allExcerptsMatched = false;
        errors.push(`Source ${ev.source_id} is ${src.status}; capture a current source first`);
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
      // Every target node is resolved *before* anything is written, because
      // atomicity has to hold against the document's shape too, not just
      // against excerpt matching: writing some hashes and then discovering
      // the next node cannot take one would leave the file half-repinned.
      const evidenceNode = doc.get("evidence");
      const targets = [];
      if (isSeq(evidenceNode)) {
        for (const { idx } of proposedRepins) {
          const itemNode = evidenceNode.get(idx);
          if (isMap(itemNode)) targets.push(itemNode);
        }
      }

      if (targets.length === proposedRepins.length) {
        proposedRepins.forEach(({ hash }, i) => targets[i].set("source_sha256", hash));
        doc.set("status", "review_ready");
        doc.delete("reviewed");
        revalidated.push(data.id);
      } else {
        // The excerpts all matched, but the hashes could not actually be
        // written: `evidence` resolves to an array through toJS() while its
        // AST is something a repin cannot address -- an alias, or a sequence
        // whose entries are not maps. Reporting this as revalidated would
        // advance the question while leaving its old hashes on disk, which is
        // exactly the claim the evidence gate must never make falsely.
        errors.push(
          `Question ${data.id || file}: evidence matched but its YAML structure cannot be repinned ` +
            `(expected a sequence of mappings; got ${evidenceNode?.constructor?.name ?? typeof evidenceNode})`,
        );
        unmatched.push(data.id);
      }
    } else {
      unmatched.push(data.id);
    }

    if (!dryRun && revalidated.includes(data.id)) writeFileSync(file, doc.toString(), "utf8");
  }

  return {
    revalidated,
    unmatched,
    errors,
    totalProcessed: needsReview.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg.startsWith("--") && arg !== "--dry-run")) throw new Error("Unknown option");
    const result = await revalidateContent({
      store: storeFromEnv(),
      ids: args.filter((arg) => arg !== "--dry-run"),
      dryRun: args.includes("--dry-run"),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length || result.unmatched.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
