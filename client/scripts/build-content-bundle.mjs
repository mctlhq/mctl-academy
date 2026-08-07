#!/usr/bin/env node
/**
 * Build-time content bundle for the mock exam client.
 *
 * Reads ../content/branding.yaml and ../content/questions/*.yaml from the
 * repo root (same read pattern as scripts/build-preview.mjs) and emits a
 * static JSON bundle of published-status questions plus the mock
 * configuration, consumed by StaticBundleDataSource
 * (client/src/exam/dataSource.ts). This keeps the mock screen buildable and
 * demoable with zero backend.
 *
 * The answer key and explanations are retained in the bundle: README.md and
 * PLAN.md are explicit that the repository (and therefore the answer key) is
 * public. Deferred feedback in the mock is a UI-state rule enforced by the
 * screens, not a secrecy boundary enforced by omitting data from the client.
 *
 * Runs as a predev/prebuild/pretest step (see package.json); output is
 * gitignored (see ../../.gitignore).
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const CLIENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(CLIENT_ROOT, "..", "content");
const OUT_DIR = join(CLIENT_ROOT, "src", "data");
const OUT_FILE = join(OUT_DIR, "mock-bundle.generated.json");

function loadYamlDir(dir) {
  const p = join(CONTENT_DIR, dir);
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parseYaml(readFileSync(join(p, f), "utf8")));
}

const branding = parseYaml(readFileSync(join(CONTENT_DIR, "branding.yaml"), "utf8"));
const allQuestions = loadYamlDir("questions");
const published = allQuestions.filter((q) => q.status === "published");

const bundle = {
  mock: {
    questionCount: branding.mock.question_count,
    timeLimitMinutes: branding.mock.time_limit_minutes,
    discloseBankSize: branding.mock.disclose_bank_size,
    domains: branding.domains.map((d) => ({
      id: d.id,
      title: d.title,
      weight: d.weight,
      mockQuestions: d.mock_questions,
    })),
  },
  bankSize: allQuestions.length,
  publishedBankSize: published.length,
  questions: published.map((q) => ({
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
  })),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(bundle, null, 2));
console.log(
  `Content bundle written to ${OUT_FILE} -- ${bundle.questions.length}/${bundle.bankSize} published questions.`,
);
