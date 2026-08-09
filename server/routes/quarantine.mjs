import { Hono } from "hono";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { rateLimit } from "../middleware/rate-limit.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR ? resolve(process.env.ACADEMY_CONTENT_DIR) : join(ROOT, "content");

export const quarantineRouter = new Hono();

let cachedIds = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60_000; // Cache for 60 seconds to avoid disk I/O on every request

export function loadYamlDir(contentDir, dir) {
  const p = join(contentDir, dir);
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => {
      try {
        return parseYaml(readFileSync(join(p, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function computeQuarantinedQuestionIds(contentDir = CONTENT) {
  const sources = loadYamlDir(contentDir, "sources");
  const driftedSourceIds = new Set(
    sources.filter((s) => s.status === "drifted" || s.status === "deprecated").map((s) => s.id),
  );

  const questions = loadYamlDir(contentDir, "questions");
  const quarantinedIds = [];

  for (const q of questions) {
    if (!q.id) continue;
    if (q.status === "needs_review") {
      quarantinedIds.push(q.id);
      continue;
    }

    if (Array.isArray(q.evidence)) {
      const citesDrifted = q.evidence.some((ev) => driftedSourceIds.has(ev.source_id));
      if (citesDrifted) {
        quarantinedIds.push(q.id);
      }
    }
  }

  return quarantinedIds;
}

export function getQuarantinedQuestionIds(forceRefresh = false, contentDir = CONTENT) {
  const now = Date.now();
  if (forceRefresh || !cachedIds || now - cacheTime > CACHE_TTL_MS) {
    cachedIds = computeQuarantinedQuestionIds(contentDir);
    cacheTime = now;
  }
  return cachedIds;
}

quarantineRouter.use("*", rateLimit());

// GET /api/quarantine - Returns list of question IDs currently quarantined due to drift or review status
quarantineRouter.get("/", (c) => {
  const ids = getQuarantinedQuestionIds();
  return c.json({
    success: true,
    quarantinedQuestionIds: ids,
    count: ids.length,
  });
});
