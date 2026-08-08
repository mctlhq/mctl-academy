import { Hono } from "hono";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR ? resolve(process.env.ACADEMY_CONTENT_DIR) : join(ROOT, "content");

export const quarantineRouter = new Hono();

function loadYamlDir(contentDir, dir) {
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

// GET /api/quarantine - Returns list of question IDs currently quarantined due to drift or review status
quarantineRouter.get("/", (c) => {
  const sources = loadYamlDir(CONTENT, "sources");
  const driftedSourceIds = new Set(
    sources.filter((s) => s.status === "drifted" || s.status === "deprecated").map((s) => s.id),
  );

  const questions = loadYamlDir(CONTENT, "questions");
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

  return c.json({
    success: true,
    quarantinedQuestionIds: quarantinedIds,
    count: quarantinedIds.length,
  });
});
