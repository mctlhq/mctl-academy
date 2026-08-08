#!/usr/bin/env node
/**
 * Content bundle for the Practice mode client.
 *
 * Filters content/questions/ down to status: published only (the same filter
 * build-preview.mjs computes as a side statistic; here it is the primary
 * selection criterion) and writes a flat JSON array the client/ Vite app
 * bundles at build time. No server, no runtime content/ filesystem access —
 * the compiled client is static assets once this has run.
 *
 * Deliberately strips fields the client does not need (evidence, authored,
 * reviewed, schema_version) so the bundle carries only what Practice mode
 * renders: id, domain, objective, stem, and options with id/text/correct/
 * explanation.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR ? resolve(process.env.ACADEMY_CONTENT_DIR) : join(ROOT, "content");
const OUT = process.env.ACADEMY_BUNDLE_OUT
  ? resolve(process.env.ACADEMY_BUNDLE_OUT)
  : join(ROOT, "client", "src", "content-bundle.json");

const load = (dir) => {
  const p = join(CONTENT, dir);
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parseYaml(readFileSync(join(p, f), "utf8")));
};

const questions = load("questions");
const published = questions.filter((q) => q.status === "published");

const bundle = published.map((q) => ({
  id: q.id,
  course_id: q.course_id || "agentic-ai-builder",
  domain: q.domain,
  objective: q.objective,
  stem: q.stem,
  options: q.options.map((o) => ({
    id: o.id,
    text: o.text,
    correct: o.correct,
    explanation: o.explanation,
  })),
}));

mkdirSync(join(OUT, ".."), { recursive: true });
writeFileSync(OUT, JSON.stringify(bundle, null, 2) + "\n");
console.log(`Content bundle written to ${OUT} — ${bundle.length}/${questions.length} questions published.`);
