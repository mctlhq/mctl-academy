#!/usr/bin/env node
/**
 * Mock-exam content bundle generator.
 *
 * Reads content/branding.yaml (mock config + domain weights) and
 * content/questions/*.yaml (published questions only), then writes
 * client/src/data/mock-bundle.generated.json — the build-time artefact that
 * the Mock Exam UI imports via dataSource.ts.
 *
 * The generated file is .gitignored (client/src/data/*.generated.json) and
 * must be regenerated inside Docker before `vite build`.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(ROOT, "content");
const OUT = process.env.ACADEMY_MOCK_BUNDLE_OUT
  ? resolve(process.env.ACADEMY_MOCK_BUNDLE_OUT)
  : join(ROOT, "client", "src", "data", "mock-bundle.generated.json");

// ---------------------------------------------------------------------------
// 1. Load branding.yaml for mock configuration and domain list
// ---------------------------------------------------------------------------
const brandingPath = join(CONTENT, "branding.yaml");
if (!existsSync(brandingPath)) {
  console.error(`ERROR: ${brandingPath} not found`);
  process.exit(1);
}
const branding = parseYaml(readFileSync(brandingPath, "utf8"));

const mockConfig = {
  questionCount: branding.mock?.question_count ?? 30,
  timeLimitMinutes: branding.mock?.time_limit_minutes ?? 60,
  discloseBankSize: branding.mock?.disclose_bank_size ?? true,
  domains: (branding.domains ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    weight: d.weight,
    mockQuestions: d.mock_questions,
  })),
};

// ---------------------------------------------------------------------------
// 2. Load published questions (same filter as build-content-bundle.mjs)
// ---------------------------------------------------------------------------
const questionsDir = join(CONTENT, "questions");
const allQuestions = [];
if (existsSync(questionsDir)) {
  for (const file of readdirSync(questionsDir).filter((f) => f.endsWith(".yaml"))) {
    allQuestions.push(parseYaml(readFileSync(join(questionsDir, file), "utf8")));
  }
}

const published = allQuestions.filter((q) => q.status === "published");

const questions = published.map((q) => ({
  id: q.id,
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

// ---------------------------------------------------------------------------
// 3. Write the bundle
// ---------------------------------------------------------------------------
const bundle = {
  mock: mockConfig,
  bankSize: allQuestions.length,
  publishedBankSize: published.length,
  questions,
};

mkdirSync(join(OUT, ".."), { recursive: true });
writeFileSync(OUT, JSON.stringify(bundle, null, 2) + "\n");
console.log(
  `Mock bundle written to ${OUT} — ${published.length}/${allQuestions.length} questions, ` +
    `${mockConfig.domains.length} domains.`
);
