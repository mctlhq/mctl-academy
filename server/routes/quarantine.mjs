import { Hono } from "hono";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { rateLimit } from "../middleware/rate-limit.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR ? resolve(process.env.ACADEMY_CONTENT_DIR) : join(ROOT, "content");

export const quarantineRouter = new Hono();

let cachedIds = null;
let cacheTime = 0;
let inFlightPromise = null;
const CACHE_TTL_MS = 60_000;

export async function loadYamlDirAsync(contentDir, dir) {
  const p = join(contentDir, dir);
  if (!existsSync(p)) return [];
  const files = await readdir(p);
  const yamlFiles = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  const parsed = [];
  for (const f of yamlFiles) {
    const text = await readFile(join(p, f), "utf8");
    const doc = parseYaml(text);
    if (doc) {
      parsed.push(doc);
    }
  }
  return parsed;
}

export async function computeQuarantinedQuestionIdsAsync(contentDir = CONTENT) {
  const sources = await loadYamlDirAsync(contentDir, "sources");
  const driftedSourceIds = new Set(
    sources.filter((s) => s.status === "drifted" || s.status === "deprecated").map((s) => s.id),
  );

  const questions = await loadYamlDirAsync(contentDir, "questions");
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

export async function getQuarantinedQuestionIdsAsync(forceRefresh = false, contentDir = CONTENT) {
  const now = Date.now();
  if (!forceRefresh && cachedIds && now - cacheTime < CACHE_TTL_MS) {
    return cachedIds;
  }

  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = computeQuarantinedQuestionIdsAsync(contentDir)
    .then((ids) => {
      cachedIds = ids;
      cacheTime = Date.now();
      return ids;
    })
    .finally(() => {
      inFlightPromise = null;
    });

  return inFlightPromise;
}

quarantineRouter.use("*", rateLimit());

// GET /api/quarantine - Returns list of question IDs currently quarantined due to drift or review status
quarantineRouter.get("/", async (c) => {
  try {
    const ids = await getQuarantinedQuestionIdsAsync();
    return c.json({
      success: true,
      quarantinedQuestionIds: ids,
      count: ids.length,
    });
  } catch (err) {
    console.error("[quarantine] Failed to compute quarantine list:", err.message);
    return c.json({ error: "Failed to compute quarantine status", details: err.message }, 500);
  }
});
