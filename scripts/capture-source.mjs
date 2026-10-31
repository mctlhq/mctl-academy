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

import { isAllowedSourceUrl, pinnedCommitOf } from "./lib/content-model.mjs";
import { storeFromEnv, sha256 } from "./lib/snapshot-store.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const CONTENT = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(ROOT, "content");
const SOURCES = join(CONTENT, "sources");

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
 * Every allowlisted docs tree (both Nebius sites, Tavily and the LeRobot docs)
 * serves a `.md` twin of every page and publishes an llms.txt index of them;
 * the nebius-physical-ai pages are Markdown files read at a pinned commit.
 * The markdown is what we snapshot: it is the same prose without the
 * navigation chrome, so a hash changes when the content changes rather than
 * when the site's header does.
 */
const FETCH_TIMEOUT_MS = 30_000;

/**
 * `verifyPin` (default on) checks a commit-pinned URL's commit is on the
 * upstream branch before fetching; see assertCommitOnBranch. Only the drift
 * check turns it off: it compares a recorded hash with bytes at a fixed
 * commit, which cannot change, and the provenance was settled when the
 * record was minted.
 */
export async function fetchSource(url, { verifyPin = true } = {}) {
  if (!isAllowedSourceUrl(url)) {
    throw new Error(`refusing to capture ${url}: not on the SOURCES.md allowlist`);
  }
  // Bounded on purpose. In --check mode this is the drift job's per-source
  // call, and one hung upstream response would otherwise pin the weekly run
  // until the Actions job timeout, delaying the drift signal by up to a week.
  // An abort surfaces as a fetch error, which check() already classifies as
  // unreachable rather than drift — the correct treatment.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const pin = pinnedCommitOf(url);
    if (pin && verifyPin) await assertCommitOnBranch(pin, controller.signal);
    const res = await fetch(url, {
      headers: { accept: "text/markdown, text/plain, text/html" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
    // fetch follows redirects, so the bytes may come from somewhere other than
    // the URL checked above. On a host allowlisted by path prefix, a redirect
    // out of the prefix would otherwise be stored under the allowlisted URL.
    if (!isAllowedSourceUrl(res.url)) {
      throw new Error(`fetch ${url}: redirected to ${res.url}, outside the SOURCES.md allowlist`);
    }
    // Ancestry was checked for the commit in the requested URL only, so the
    // bytes must come from that same commit (or from no pinned commit at all).
    const landed = pinnedCommitOf(res.url);
    if (verifyPin && landed && landed.sha !== pin?.sha) {
      throw new Error(`fetch ${url}: redirected to ${res.url}, an unverified commit`);
    }
    return await res.text();
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`fetch ${url}: timed out after ${FETCH_TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refuse a pinned commit unless it is reachable from the repository's branch.
 * `compare/<sha>...<branch>` is `ahead` or `identical` exactly when the
 * commit is an ancestor of the branch tip. A fork-only commit compares as
 * `diverged` or is not found. Any other answer, including a failed request,
 * refuses: an unverified commit is not a verified one.
 */
async function assertCommitOnBranch({ repo, branch, sha }, signal) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${repo}/compare/${sha}...${branch}`, {
    headers: {
      accept: "application/vnd.github+json",
      // The REST API refuses a request without one; set it rather than rely
      // on the runtime's default.
      "user-agent": "mctl-academy-capture",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal,
  });
  if (!res.ok) throw new Error(`verify ${repo}@${sha}: compare with ${branch} returned HTTP ${res.status}`);
  const { status } = await res.json();
  if (status !== "ahead" && status !== "identical") {
    throw new Error(`refusing ${repo}@${sha}: commit is not on ${branch} (compare status ${status})`);
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
  const record = buildSourceRecord({ id, url, title, objectives, hash, key, previous });

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
      const text = await fetchSource(data.url, { verifyPin: false });
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
 * The source record as it will be written. A capture rebuilds it from scratch,
 * so every field of an existing record that is not reconstructed here is
 * erased. That was tolerable while `snapshot:capture` was a manual command run
 * by whoever also wrote those fields; the replenish workflow re-captures every
 * drifted source unattended each week, and no lint can notice a field that is
 * simply gone -- so `coverage` and `notes` are carried forward explicitly.
 *
 * @param {{ id: string, url: string, title?: string, objectives: string[],
 *           hash: string, key: string, previous: any }} args
 */
export function buildSourceRecord({ id, url, title, objectives, hash, key, previous }) {
  /** @type {Record<string, any>} */
  const record = {
    schema_version: 1,
    id,
    url,
    // Same reason as validateSelection: minLength 1, and a url ending in
    // "/" leaves pop() empty. `||` rather than `??` so "" falls through too.
    title: title || url.split("/").pop().replace(/\.md$/, "") || id,
    retrieved_at: nowUtc(),
    sha256: hash,
    objectives,
    snapshot: { bucket: process.env.R2_BUCKET ?? "academy-source-snapshots", key },
    status: "current",
    ...(previous?.coverage ? { coverage: previous.coverage } : {}),
    ...(previous?.notes ? { notes: previous.notes } : {}),
  };
  const versions = mergeVersions(previous, hash);
  if (versions.length) record.versions = versions;
  return record;
}

/**
 * A re-capture of a source already marked `drifted` keeps the earlier hashes
 * in `versions`: the quarantined items still pinned to an older snapshot stay
 * verifiable against the store instead of failing "does not belong to
 * declared source". Only across a recorded drift: re-capturing a `current`
 * source whose page changed must still fail loudly for every dependent, or the
 * gate's core claim would be weakened for the convenience of one caller.
 */
export function mergeVersions(previous, hash) {
  if (!previous) return [];
  // Hashes already registered are carried forward on EVERY re-capture: a
  // routine refresh of a `current` source must not drop the provenance that
  // an earlier drift registered, or every item still pinned to one of those
  // hashes fails the citation check. Only the previous hash itself is a
  // judgement call, and it joins the list solely across a recorded drift --
  // re-capturing a `current` source whose page changed must still fail
  // loudly for its dependents.
  const kept = Array.isArray(previous.versions) ? previous.versions : [];
  const all = previous.status === "drifted" ? [...kept, previous.sha256] : kept;
  return [...new Set(all.filter((v) => typeof v === "string" && v !== hash))];
}

/**
 * The mode is the FIRST argument, never a global search: every other argv entry
 * can carry text this repository did not write -- `--title` receives the page
 * title scraped from the llms.txt index -- and a page titled `--check` would
 * otherwise flip a capture into a drift check, exit 0 with no snapshot written,
 * and fail several steps later as "no such source record".
 *
 * @param {string[]} argv
 * @returns {"check" | "capture"}
 */
export function parseMode(argv) {
  return argv[0] === "--check" ? "check" : "capture";
}

/**
 * Positional first, flags after -- and every flag value read as a value, never
 * found by scanning. Same reason as `parseMode`: `--title` receives the page
 * title scraped from the llms.txt index, so a page titled `--objective` would
 * otherwise be reduced into the objective list and write a record that fails
 * `lint:content` at the end of the capture step, discarding a run whose page
 * was already fetched, hashed and uploaded.
 *
 * @param {string[]} argv
 * @returns {{ url?: string, id?: string, title?: string, objectives: string[] }}
 */
export function parseCaptureArgs(argv) {
  /** @type {{ url?: string, id?: string, title?: string, objectives: string[] }} */
  const out = { objectives: [] };
  if (argv[0] && !argv[0].startsWith("--")) out.url = argv[0];
  for (let i = out.url ? 1 : 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (!name.startsWith("--")) throw new Error(`unexpected argument ${JSON.stringify(name)}`);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${name} needs a value`);
    i += 1;
    if (name === "--id") out.id = value;
    else if (name === "--title") out.title = value;
    else if (name === "--objective") out.objectives.push(value);
    else throw new Error(`unknown option ${name}`);
  }
  return out;
}

const args = process.argv[1] === fileURLToPath(import.meta.url) ? process.argv.slice(2) : null;

if (args && parseMode(args) === "check") {
  const markDrifted = args.includes("--mark-drifted");
  process.exit(await check({ markDrifted }));
}

if (args) {
  /** @type {ReturnType<typeof parseCaptureArgs>} */
  let parsed;
  try {
    parsed = parseCaptureArgs(args);
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  }
  if (!parsed.url?.startsWith("https://") || !parsed.id || !parsed.objectives.length) {
    console.error(
      "usage: capture-source.mjs <url> --id <src-id> --objective <domain-N/obj> [--objective ...]",
    );
    console.error("       capture-source.mjs --check [--mark-drifted]");
    process.exit(1);
  }
  await capture({ url: parsed.url, id: parsed.id, objectives: parsed.objectives, title: parsed.title });
}
