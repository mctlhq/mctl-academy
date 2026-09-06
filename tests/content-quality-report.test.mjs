import { test } from "node:test";
import assert from "node:assert/strict";
import { qualityReport } from "../scripts/content-quality-report.mjs";

test("reports publication-scoped coverage, quality signals and mock shortfalls independently per course", () => {
  const q = (id, status = "published", course_id = "course") => ({
    id,
    status,
    course_id,
    domain: "domain-1",
    objective: "domain-1/topic",
    stem: "Which setting controls automatic scaling of replicas?",
    options: [
      { text: "Configured automatic replica scaling policy", correct: true },
      { text: "X", correct: false },
    ],
    evidence: [{ source_id: "src-doc", excerpt: "replicas scale according to the policy" }],
  });
  const courses = new Map([
    [
      "course",
      {
        id: "course",
        domains: [
          { id: "domain-1", weight: 100, mock_questions: 3, objectives: [{ id: "topic" }, { id: "empty" }] },
        ],
      },
    ],
  ]);
  const sources = new Map([["src-doc", { coverage: [{ course_id: "other", objective: "domain-1/topic" }] }]]);
  const [report] = qualityReport({
    courses,
    sources,
    questions: [q("a"), q("b"), q("hidden", "needs_review"), q("other", "published", "other")],
  });
  assert.equal(report.published, 2);
  assert.equal(report.needsReview, 1);
  assert.equal(report.domains[0].mockShortfall, 1);
  assert.equal(report.domains[0].objectives[1].published, 0);
  assert.deepEqual(report.longestCorrect, ["a", "b"]);
  assert.deepEqual(report.sourceObjectiveMismatches, ["a", "b"]);
  assert.deepEqual(report.repeatedCitations, [["a", "b"]]);
  assert.deepEqual(report.similarQuestions[0].ids, ["a", "b"]);
});
