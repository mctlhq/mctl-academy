#!/usr/bin/env node
/** Advisory authoring diagnostics, never a substitute for evidence/human review. */
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadCourses, loadSources, loadYamlDir } from "./lib/content-model.mjs";

const words = (text) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
const overlap = (a, b) => {
  const left = words(a),
    right = words(b);
  const intersection = [...left].filter((w) => right.has(w)).length;
  return intersection / (new Set([...left, ...right]).size || 1);
};

export function qualityReport({ courses, sources, questions }) {
  return [...courses.values()].map((course) => {
    const bank = questions.filter((q) => q.course_id === course.id && q.status === "published");
    const citationGroups = new Map();
    const sourceObjectiveMismatches = [];
    const longestCorrect = [];
    for (const q of bank) {
      const correct = q.options.find((o) => o.correct);
      if (correct && q.options.every((o) => o.correct || correct.text.length > o.text.length))
        longestCorrect.push(q.id);
      for (const ev of q.evidence) {
        const key = `${ev.source_id}:${ev.excerpt.replace(/\s+/g, " ").trim()}`;
        if (!citationGroups.has(key)) citationGroups.set(key, []);
        citationGroups.get(key).push(q.id);
      }
      const mapped = q.evidence.some((ev) => {
        const source = sources.get(ev.source_id);
        return (
          source?.coverage?.some((c) => c.course_id === course.id && c.objective === q.objective) ||
          source?.objectives?.includes(q.objective)
        );
      });
      if (!mapped) sourceObjectiveMismatches.push(q.id);
    }
    const similarQuestions = [];
    for (let i = 0; i < bank.length; i++) {
      for (let j = i + 1; j < bank.length; j++) {
        const a = bank[i],
          b = bank[j];
        const stemSimilarity = overlap(a.stem, b.stem);
        const answerSimilarity = overlap(
          a.options.find((o) => o.correct)?.text ?? "",
          b.options.find((o) => o.correct)?.text ?? "",
        );
        if (stemSimilarity >= 0.6 || (stemSimilarity >= 0.2 && answerSimilarity >= 0.8)) {
          similarQuestions.push({ ids: [a.id, b.id], stemSimilarity, answerSimilarity });
        }
      }
    }
    const domains = course.domains.map((d) => {
      const inDomain = bank.filter((q) => q.domain === d.id);
      return {
        id: d.id,
        weight: d.weight,
        published: inDomain.length,
        bankPercent: bank.length ? Math.round((inDomain.length / bank.length) * 100) : 0,
        mockNeeded: d.mock_questions,
        mockShortfall: Math.max(0, d.mock_questions - inDomain.length),
        objectives: d.objectives.map((o) => ({
          id: o.id,
          published: inDomain.filter((q) => q.objective === `${d.id}/${o.id}`).length,
        })),
      };
    });
    return {
      course: course.id,
      published: bank.length,
      needsReview: questions.filter((q) => q.course_id === course.id && q.status === "needs_review").length,
      longestCorrect,
      sourceObjectiveMismatches,
      domains,
      repeatedCitations: [...citationGroups.values()].filter((ids) => ids.length > 1),
      similarQuestions,
    };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const contentDir = process.env.ACADEMY_CONTENT_DIR ?? fileURLToPath(new URL("../content", import.meta.url));
  const report = qualityReport({
    courses: loadCourses(contentDir),
    sources: loadSources(contentDir),
    questions: loadYamlDir(contentDir, "questions").map((e) => e.data),
  });
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      "Advisory content quality report: signals require inspection, not automatic approval or rewriting.",
    );
    for (const c of report) {
      console.log(`\n${c.course}: ${c.published} published; ${c.needsReview} need review`);
      console.log(
        `Strictly longest correct option: ${c.longestCorrect.length}/${c.published}; source/objective mismatches: ${c.sourceObjectiveMismatches.length}`,
      );
      for (const d of c.domains) {
        console.log(
          `${d.id}: ${d.published} questions (${d.bankPercent}% of bank vs ${d.weight}% weight); mock shortfall ${d.mockShortfall}`,
        );
        console.log(`  Objectives: ${d.objectives.map((o) => `${o.id}=${o.published}`).join(", ")}`);
      }
      for (const ids of c.repeatedCitations) console.log(`Repeated citation: ${ids.join(", ")}`);
      for (const pair of c.similarQuestions) console.log(`Similar question/answer: ${pair.ids.join(", ")}`);
      if (c.sourceObjectiveMismatches.length)
        console.log(`Check mappings: ${c.sourceObjectiveMismatches.join(", ")}`);
    }
    console.log(`\nEvidence policy: ${join(contentDir, "..", "CONTENT-POLICY.md")}`);
  }
}
