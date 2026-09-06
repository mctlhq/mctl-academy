#!/usr/bin/env node
/**
 * Capture an allowlisted source: fetch it, hash it, store the snapshot, and
 * write the source record that questions cite.
 *
 * Also runs in `--check` mode, which fetches and compares hashes without
 * writing anything. That is what the weekly drift job uses, so drift detection
 * and capture can never disagree about what "the current bytes" means — they
 * are the same code path.
 *
 *   node scripts/capture-source.mjs https://docs.tokenfactory.nebius.com/x.md \
 *     --id src-function-calling --objective domain-2/function-calling
 *
 *   node scripts/capture-source.mjs --check          # all recorded sources
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { storeFromEnv, sha256 } from "./lib/snapshot-store.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const CONTENT = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(ROOT, "content");
const SOURCES = join(CONTENT, "sources");

/** Mirrors SOURCES.md. Duplicated in validate-content.mjs, which lints it. */
const ALLOWED_HOSTS = ["docs.tokenfactory.nebius.com", "docs.nebius.com"];

const nowUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

function listSources() {
  if (!existsSync(SOURCES)) return [];
  return readdirSync(SOURCES)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => ({ path: join(SOURCES, f), data: parseYaml(readFileSync(join(SOURCES, f), "utf8")) }));
}

/**
 * Fetch a source document.
 *
 * Both Nebius doc sites serve a `.md` twin of every page and publish an
 * llms.txt index of them. The markdown is what we snapshot: it is the same
 * prose without the navigation chrome, so a hash changes when the content
 * changes rather than when the site's header does.
 */
const FETCH_TIMEOUT_MS = 30_000;

async function fetchSource(url) {
  const host = new URL(url).host;
  if (!ALLOWED_HOSTS.includes(host)) {
    throw new Error(`refusing to capture ${host}: not on the SOURCES.md allowlist`);
  }
  // Bounded on purpose. In --check mode this is the drift job's per-source
  // call, and one hung upstream response would otherwise pin the weekly run
  // until the Actions job timeout, delaying the drift signal by up to a week.
  // An abort surfaces as a fetch error, which check() already classifies as
  // unreachable rather than drift — the correct treatment.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "text/markdown, text/plain, text/html" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`fetch ${url}: timed out after ${FETCH_TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function capture({ url, id, objectives, title }) {
  const store = storeFromEnv();
  if (!store)
    throw new Error(
      "snapshot store is not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)",
    );

  const text = await fetchSource(url);
  const hash = sha256(Buffer.from(text, "utf8"));
  const key = await store.put(text);

  const previous = existsSync(join(SOURCES, `${id}.yaml`))
    ? parseYaml(readFileSync(join(SOURCES, `${id}.yaml`), "utf8"))
    : null;
  const record = {
    schema_version: 1,
    id,
    url,
    title: title ?? url.split("/").pop().replace(/\.md$/, ""),
    retrieved_at: nowUtc(),
    sha256: hash,
    objectives,
    snapshot: { bucket: process.env.R2_BUCKET ?? "academy-source-snapshots", key },
    status: "current",
  };
  const versions = mergeVersions(previous, hash);
  if (versions.length) record.versions = versions;

  mkdirSync(SOURCES, { recursive: true });
  writeFileSync(join(SOURCES, `${id}.yaml`), stringifyYaml(record));
  console.log(`captured ${id}  ${hash.slice(0, 12)}...  ${text.length} bytes`);
  return record;
}

/**
 * Compare every recorded source against its live document.
 *
 * Prints one line per drifted source in a stable, greppable form so the drift
 * workflow can act on it without parsing prose. Exit code 2 means "drift
 * found" — distinct from 1, which means the check itself failed.
 */
async function check({ markDrifted = false } = {}) {
  const sources = listSources();
  if (!sources.length) {
    console.log("no sources recorded yet");
    return 0;
  }
  let drifted = 0;
  let failed = 0;

  for (const { path: sourcePath, data } of sources) {
    try {
      const text = await fetchSource(data.url);
      const hash = sha256(Buffer.from(text, "utf8"));
      if (hash === data.sha256) {
        console.log(`ok       ${data.id}`);
      } else {
        drifted += 1;
        if (markDrifted) {
          data.status = "drifted";
          writeFileSync(sourcePath, stringifyYaml(data));
        }
        console.log(`DRIFTED  ${data.id}  ${data.sha256.slice(0, 12)} -> ${hash.slice(0, 12)}  ${data.url}`);
      }
    } catch (e) {
      // An unreachable source is not drift; conflating the two would mark
      // content needs_review every time the docs site has a bad minute.
      failed += 1;
      console.error(`ERROR    ${data.id}: ${e.message}`);
    }
  }

  console.log(`\n${sources.length} source(s): ${drifted} drifted, ${failed} unreachable`);
  if (failed) return 1;
  return drifted ? 2 : 0;
}

/**
 * A re-capture keeps the earlier hashes in `versions`: questions still pinned
 * to an older snapshot (published dependents until the quarantine lands,
 * needs_review items the new page no longer supports) stay verifiable against
 * the store instead of failing "does not belong to declared source".
 */
export function mergeVersions(previous, hash) {
  if (!previous) return [];
  const all = [...(Array.isArray(previous.versions) ? previous.versions : []), previous.sha256];
  return [...new Set(all.filter((v) => typeof v === "string" && v !== hash))];
}

const args = process.argv[1] === fileURLToPath(import.meta.url) ? process.argv.slice(2) : null;

if (args && args.includes("--check")) {
  const markDrifted = args.includes("--mark-drifted");
  process.exit(await check({ markDrifted }));
}

const url = args?.find((a) => a.startsWith("https://"));
if (args && !url) {
  console.error("usage: capture-source.mjs <url> --id <src-id> --objective <domain-N/obj> [--objective ...]");
  console.error("       capture-source.mjs --check");
  process.exit(1);
}
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const objectives = (args ?? []).reduce(
  (acc, a, i) => (a === "--objective" ? [...acc, args[i + 1]] : acc),
  [],
);

if (args && (!flag("id") || !objectives.length)) {
  console.error("--id and at least one --objective are required");
  process.exit(1);
}

if (args) await capture({ url, id: flag("id"), objectives, title: flag("title") });
