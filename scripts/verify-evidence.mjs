#!/usr/bin/env node
/**
 * Citation verification — the hard gate.
 *
 * For every cited source, fetch its immutable snapshot from the private store
 * and assert that each evidence excerpt occurs **verbatim** inside it. This is
 * the check that makes a citation mean something; without it, an excerpt is
 * just a string an agent wrote next to a URL.
 *
 * Runs separately from `lint:content` because it needs credentials, and GitHub
 * does not expose secrets to fork-triggered workflows. See CONTRIBUTING.md.
 *
 * Fails closed. An unreachable store, a missing snapshot, or an excerpt that
 * does not appear are all failures — never warnings — for anything that claims
 * `published` status.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { storeFromEnv } from "./lib/snapshot-store.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

/**
 * Fold away differences that are pure typesetting, and nothing else.
 *
 * Line wrapping is the reason this exists: documentation wraps at whatever
 * width it likes, so a 25-word excerpt quoted from a rendered page routinely
 * spans a newline that is not present in the excerpt. Collapsing whitespace
 * keeps the comparison exact at word level while ignoring where the source
 * chose to break lines.
 *
 * Curly quotes and non-breaking spaces get the same treatment for the same
 * reason: they are rendering artifacts, and an author copying a sentence has
 * no reliable control over which variant lands in their clipboard.
 *
 * Deliberately NOT normalized: case, punctuation, dashes, and word order.
 * Those carry meaning, and folding them would let a paraphrase pass a check
 * whose entire purpose is to reject paraphrase.
 */
export function normalize(text) {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadYamlDir(contentDir, dir) {
  const path = join(contentDir, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => ({
      file: `content/${dir}/${f}`,
      data: parseYaml(readFileSync(join(path, f), "utf8")),
    }));
}

/**
 * @param {object} opts
 * @param {string} opts.contentDir
 * @param {{get(key: string): Promise<string|null>}|null} opts.store
 * @returns {Promise<{errors: string[], checked: number, skipped: number}>}
 */
export async function verifyEvidence({ contentDir, store }) {
  const errors = [];
  let checked = 0;
  let skipped = 0;

  const sources = loadYamlDir(contentDir, "sources");
  const byId = new Map(sources.map((s) => [s.data.id, s.data]));

  const items = [
    ...loadYamlDir(contentDir, "questions"),
    ...loadYamlDir(contentDir, "lessons"),
  ];

  // Nothing to verify is a legitimate state early in the project's life, but
  // it must not look like a passing verification of real content.
  const publishable = items.filter((i) => i.data?.status === "published");

  if (!store) {
    if (publishable.length) {
      errors.push(
        `snapshot store is not configured, but ${publishable.length} item(s) claim published status. ` +
          "Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY. Refusing to pass unverified content.",
      );
    }
    return { errors, checked, skipped: items.length };
  }

  // One fetch per source, not per excerpt: a source page backs many questions
  // and the snapshot is immutable, so re-fetching would only cost time.
  const snapshots = new Map();
  async function snapshotFor(sourceId) {
    if (snapshots.has(sourceId)) return snapshots.get(sourceId);
    const src = byId.get(sourceId);
    let value = { text: null, reason: null };
    if (!src) {
      value.reason = `cites unknown source ${sourceId}`;
    } else if (!src.snapshot) {
      value.reason = `source ${sourceId} has no snapshot recorded`;
    } else {
      try {
        const text = await store.get(src.snapshot.key);
        if (text === null) {
          value.reason = `snapshot ${src.snapshot.key} for ${sourceId} is not in the store`;
        } else {
          value.text = text;
        }
      } catch (e) {
        value.reason = `snapshot ${src.snapshot.key} for ${sourceId}: ${e.message}`;
      }
    }
    snapshots.set(sourceId, value);
    return value;
  }

  for (const { file, data } of items) {
    if (!data?.evidence) continue;
    // Drafts may legitimately cite a source not yet snapshotted; they cannot
    // be selected by learners, so an unverified draft is not a live claim.
    const enforce = data.status === "published" || data.status === "needs_review";
    if (!enforce) {
      skipped += data.evidence.length;
      continue;
    }

    for (const ev of data.evidence) {
      const { text, reason } = await snapshotFor(ev.source_id);
      if (!text) {
        errors.push(`${file}: ${reason}`);
        continue;
      }
      checked += 1;
      if (!normalize(text).includes(normalize(ev.excerpt))) {
        errors.push(
          `${file}: excerpt not found verbatim in ${ev.source_id}: "${ev.excerpt.slice(0, 80)}"` +
            (ev.excerpt.length > 80 ? "..." : ""),
        );
      }
    }
  }

  return { errors, checked, skipped };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const contentDir = process.env.ACADEMY_CONTENT_DIR
    ? resolve(process.env.ACADEMY_CONTENT_DIR)
    : join(ROOT, "content");

  const { errors, checked, skipped } = await verifyEvidence({
    contentDir,
    store: storeFromEnv(),
  });

  for (const e of errors) console.error(`error ${e}`);
  if (errors.length) {
    console.error(`\nEvidence verification failed: ${errors.length} error(s).`);
    process.exit(1);
  }
  console.log(`Evidence verification passed: ${checked} citation(s) verified, ${skipped} skipped (draft).`);
}
