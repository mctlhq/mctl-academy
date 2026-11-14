import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/**
 * Real questions from content/questions, with their correct and one wrong
 * option id, for server tests that post attempts. POST /api/attempts grades
 * against the answer key the server loads from content/ (issue #208), so a
 * made-up question id is now a 400. Ids are read rather than hard-coded so
 * that retiring a question does not break unrelated server tests.
 */
const QUESTIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "content", "questions");

function load() {
  const out = [];
  for (const file of readdirSync(QUESTIONS_DIR).sort()) {
    if (!file.endsWith(".yaml")) continue;
    const doc = parseYaml(readFileSync(join(QUESTIONS_DIR, file), "utf8"));
    if (doc?.status !== "published" || !Array.isArray(doc.options)) continue;
    const correct = doc.options.filter((o) => o.correct === true);
    const wrong = doc.options.find((o) => o.correct !== true);
    if (correct.length !== 1 || !wrong) continue;
    out.push({ id: doc.id, domain: doc.domain, correctOptionId: correct[0].id, wrongOptionId: wrong.id });
  }
  return out;
}

export const gradableQuestions = load();

/** The n-th gradable question; throws if content/ has fewer than n + 1. */
export function gradableQuestion(n) {
  const q = gradableQuestions[n];
  if (!q)
    throw new Error(`content/questions has fewer than ${n + 1} published questions for the attempt fixtures`);
  return q;
}
