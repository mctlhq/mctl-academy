#!/usr/bin/env node
/**
 * Discovery half of the "Nebius Docs Sync" that SOURCES.md and PLAN.md §10
 * describe. Until this script existed only the drift half ran (the weekly
 * Source drift job re-hashes the sources already recorded); nothing ever
 * looked for pages the bank does not cite yet.
 *
 * Three signals, all deterministic, no LLM:
 *
 *   1. New pages: every `.md` page listed in the canonical llms.txt indices
 *      that no content/sources/*.yaml record, no capture-manifest row and no
 *      `ignored:` entry in content/discovery-state.yaml already names.
 *   2. Drifted sources: records whose status is `drifted`, or -- with
 *      --check-live -- whose live bytes no longer hash to the recorded sha256
 *      (a quarantine PR that is not merged yet leaves main saying `current`).
 *      Each is classified with detect-docs-delta.mjs against the snapshot
 *      stored in R2, when credentials are present.
 *   3. Gaps: Mock shortfalls per domain and objectives with fewer published
 *      questions than --min-per-objective, from the content quality report.
 *
 * The output is a candidates.json that an authoring run reads as data. This
 * script never writes under content/ except the discovery watermark, and only
 * with --update-state.
 *
 * Usage:
 *   node scripts/discover-docs.mjs [--out candidates.json] [--max-new 3]
 *        [--check-live] [--update-state] [--min-per-objective 3]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ALLOWED_HOSTS, loadCourses, loadSources, loadYamlDir } from "./lib/content-model.mjs";
import { storeFromEnv, sha256 } from "./lib/snapshot-store.mjs";
import { detectDocsDelta } from "./detect-docs-delta.mjs";
import { qualityReport } from "./content-quality-report.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(ROOT, "content");

export const LLMS_INDICES = [
  "https://docs.tokenfactory.nebius.com/llms.txt",
  "https://docs.nebius.com/llms.txt",
];
const FETCH_TIMEOUT_MS = 30_000;

export async function fetchText(url) {
  const host = new URL(url).host;
  if (!ALLOWED_HOSTS.includes(host))
    throw new Error(`refusing to fetch ${host}: not on the SOURCES.md allowlist`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "text/markdown, text/plain, text/html" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * llms.txt lines look like `- [Title](https://host/path.md): description`.
 * Anything that is not an allowlisted `.md` page is dropped: the index also
 * lists itself and occasionally external links.
 */
export function parseLlmsIndex(text) {
  const pages = [];
  const seen = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.match(/^\s*-\s*\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)\s*(?::\s*(.*))?$/);
    if (!m) continue;
    const [, title, url, description = ""] = m;
    let host;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }
    if (!ALLOWED_HOSTS.includes(host) || !url.endsWith(".md") || seen.has(url)) continue;
    seen.add(url);
    pages.push({ url, title: title.trim(), description: description.trim(), host });
  }
  return pages;
}

export function loadDiscoveryState(file) {
  if (!existsSync(file)) return { seen: [], ignored: [] };
  const doc = parseYaml(readFileSync(file, "utf8")) ?? {};
  return {
    seen: Array.isArray(doc.seen) ? doc.seen : [],
    ignored: Array.isArray(doc.ignored) ? doc.ignored : [],
  };
}

export function knownUrls(contentDir) {
  const urls = new Set();
  for (const { data } of loadYamlDir(contentDir, "sources")) if (data?.url) urls.add(data.url);
  const manifest = join(contentDir, "capture-manifest.yaml");
  if (existsSync(manifest)) {
    for (const row of parseYaml(readFileSync(manifest, "utf8"))?.sources ?? [])
      if (row?.url) urls.add(row.url);
  }
  return urls;
}

/** Pages in the indices that nothing in content/ names, oldest first-seen first. */
export function newPages({ pages, known, state, today }) {
  const ignored = new Set(state.ignored.map((e) => e.url));
  const firstSeen = new Map(state.seen.map((e) => [e.url, e.first_seen]));
  return pages
    .filter((p) => !known.has(p.url) && !ignored.has(p.url))
    .map((p) => ({ ...p, first_seen: firstSeen.get(p.url) ?? today }))
    .sort((a, b) => a.first_seen.localeCompare(b.first_seen) || a.url.localeCompare(b.url));
}

/**
 * Primary documentation host per course, from the SOURCES.md priority matrix.
 * A page on a course's primary host ranks above one on its secondary host,
 * and a page whose path names an objective with a gap ranks above both.
 */
export const COURSE_PRIMARY_HOST = {
  "agentic-ai-builder": "docs.tokenfactory.nebius.com",
  "ai-cloudops-engineer": "docs.nebius.com",
  "ai-leader": "docs.tokenfactory.nebius.com",
};

export function rankPages(pages, gaps) {
  const hostScore = new Map();
  const slugTokens = new Set();
  for (const g of gaps) {
    const host = COURSE_PRIMARY_HOST[g.course];
    if (host) hostScore.set(host, (hostScore.get(host) ?? 0) + 1);
    for (const token of (g.objective ?? "").split("/").pop()?.split("-") ?? []) {
      if (token.length > 3) slugTokens.add(token);
    }
  }
  const score = (p) => {
    const path = new URL(p.url).pathname.toLowerCase();
    const slugHit = [...slugTokens].some((t) => path.includes(t)) ? 1 : 0;
    return slugHit * 1000 + (hostScore.get(p.host) ?? 0);
  };
  return [...pages].sort(
    (a, b) => score(b) - score(a) || a.first_seen.localeCompare(b.first_seen) || a.url.localeCompare(b.url),
  );
}

export function gapsFrom(report, minPerObjective) {
  const gaps = [];
  for (const course of report) {
    for (const d of course.domains) {
      if (d.mockShortfall > 0) {
        gaps.push({
          course: course.course,
          kind: "mock-shortfall",
          domain: d.id,
          published: d.published,
          needed: d.mockNeeded,
        });
      }
      for (const o of d.objectives) {
        if (o.published < minPerObjective) {
          gaps.push({
            course: course.course,
            kind: "objective",
            objective: `${d.id}/${o.id}`,
            published: o.published,
            needed: minPerObjective,
          });
        }
      }
    }
  }
  return gaps.sort((a, b) => a.published - b.published);
}

/**
 * @param {object} [deps]
 * @param {string} [deps.contentDir]
 * @param {string} [deps.stateFile]
 * @param {number} [deps.maxNew]
 * @param {boolean} [deps.checkLive]
 * @param {number} [deps.minPerObjective]
 * @param {string} [deps.today]
 * @param {(url: string) => Promise<string>} [deps.fetch]
 * @param {{ get(key: string): Promise<string | null> } | null} [deps.store]
 * @param {string[]} [deps.indices]
 * @param {(msg: string) => void} [deps.warn]
 */
export async function discover({
  contentDir = CONTENT,
  stateFile = join(contentDir, "discovery-state.yaml"),
  maxNew = 3,
  checkLive = false,
  minPerObjective = 3,
  today = new Date().toISOString().slice(0, 10),
  fetch = fetchText,
  store = storeFromEnv(),
  indices = LLMS_INDICES,
  warn = (msg) => console.warn(`::warning::${msg}`),
} = {}) {
  const state = loadDiscoveryState(stateFile);
  const pages = [];
  for (const index of indices) {
    try {
      pages.push(...parseLlmsIndex(await fetch(index)));
    } catch (e) {
      warn(`index ${index} unavailable: ${e.message}`);
    }
  }
  const fresh = newPages({ pages, known: knownUrls(contentDir), state, today });

  const drifted = [];
  for (const { data } of loadYamlDir(contentDir, "sources")) {
    if (!data?.id || data.status === "deprecated") continue;
    let live = null;
    let liveSha = null;
    if (checkLive || data.status === "drifted") {
      try {
        live = await fetch(data.url);
        liveSha = sha256(Buffer.from(live, "utf8"));
      } catch (e) {
        // A record already marked drifted is drifted whether or not the live
        // page answers today; only the delta classification needs the fetch.
        // A record marked current is left alone: unreachable is not drift.
        if (data.status === "drifted") {
          warn(`${data.id}: live fetch failed (${e.message}); reported as drifted, delta not classified`);
        } else {
          warn(`${data.id}: live fetch failed (${e.message}); treated as unreachable, not drifted`);
          continue;
        }
      }
    }
    const isDrifted = data.status === "drifted" || (liveSha !== null && liveSha !== data.sha256);
    if (!isDrifted) continue;
    const entry = {
      id: data.id,
      url: data.url,
      title: data.title,
      objectives: data.objectives ?? [],
      recordedStatus: data.status ?? "current",
      oldSha: data.sha256,
      newSha: liveSha,
      classification: "unknown",
      summary: "",
    };
    if (store && live !== null) {
      const old = await store.get(data.snapshot?.key ?? data.sha256);
      if (old === null)
        warn(`${data.id}: snapshot ${data.sha256} missing from the store; delta not classified`);
      else {
        const delta = detectDocsDelta({
          oldText: old,
          newText: live,
          sourceId: data.id,
          objectives: entry.objectives,
        });
        entry.classification = delta.classification;
        entry.summary = delta.summary;
        entry.addedLines = delta.addedLines.length;
        entry.removedLines = delta.removedLines.length;
      }
    } else if (!store) warn(`${data.id}: no R2 credentials; delta not classified`);
    drifted.push(entry);
  }

  const report = qualityReport({
    courses: loadCourses(contentDir),
    sources: loadSources(contentDir),
    questions: loadYamlDir(contentDir, "questions").map((e) => e.data),
  });
  const gaps = gapsFrom(report, minPerObjective);

  const selectedNew = rankPages(fresh, gaps).slice(0, maxNew);
  const result = {
    generated_at: new Date().toISOString(),
    empty: selectedNew.length === 0 && drifted.length === 0 && gaps.length === 0,
    newPages: selectedNew,
    newPagesTotal: fresh.length,
    drifted,
    gaps,
  };
  result.summary = summarize(result);
  const nextState = {
    seen: [
      ...state.seen.filter((e) => !fresh.some((p) => p.url === e.url)),
      ...fresh.map((p) => ({ url: p.url, first_seen: p.first_seen })),
    ],
    ignored: state.ignored,
  };
  return { result, nextState, stateFile };
}

export function summarize({ newPages, newPagesTotal, drifted, gaps }) {
  const lines = [];
  lines.push(`## New pages (${newPages.length} of ${newPagesTotal} not yet cited)`);
  for (const p of newPages)
    lines.push(
      `- ${p.title}: ${p.url}${p.description ? ` — ${p.description}` : ""} (first seen ${p.first_seen})`,
    );
  if (!newPages.length) lines.push("- none");
  lines.push("", `## Drifted sources (${drifted.length})`);
  for (const d of drifted) lines.push(`- ${d.id} [${d.classification}] ${d.summary || d.url}`);
  if (!drifted.length) lines.push("- none");
  lines.push("", `## Gaps (${gaps.length})`);
  for (const g of gaps) {
    lines.push(
      g.kind === "mock-shortfall"
        ? `- ${g.course} ${g.domain}: Mock needs ${g.needed}, ${g.published} published`
        : `- ${g.course} ${g.objective}: ${g.published} published, target ${g.needed}`,
    );
  }
  if (!gaps.length) lines.push("- none");
  return lines.join("\n");
}

function parseArgs(argv) {
  const opts = { out: null, maxNew: 3, checkLive: false, updateState: false, minPerObjective: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--max-new") opts.maxNew = Number(argv[++i]);
    else if (a === "--min-per-objective") opts.minPerObjective = Number(argv[++i]);
    else if (a === "--check-live") opts.checkLive = true;
    else if (a === "--update-state") opts.updateState = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!Number.isInteger(opts.maxNew) || opts.maxNew < 0)
    throw new Error("--max-new must be a non-negative integer");
  return opts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const { result, nextState, stateFile } = await discover(opts);
    if (opts.out) writeFileSync(opts.out, JSON.stringify(result, null, 2) + "\n");
    if (opts.updateState) writeFileSync(stateFile, stringifyYaml(nextState));
    console.log(result.summary);
    console.log(`\nempty=${result.empty}`);
  } catch (e) {
    console.error(`discover-docs: ${e.message}`);
    process.exit(1);
  }
}
