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

test("a record shared across courses is on-objective through its course-aware coverage", () => {
  const course = (id, objective) => ({
    id,
    domains: [{ id: "domain-1", weight: 100, mock_questions: 1, objectives: [{ id: objective }] }],
  });
  const courses = new Map([
    ["ops", course("ops", "node-recovery")],
    ["infra", course("infra", "ie-long-run-reliability")],
  ]);
  // Shaped like src-co-k8s-health-checks: a CloudOps objective in the bare
  // list, IE coverage added beside it.
  const sources = new Map([
    [
      "src-shared",
      {
        objectives: ["domain-1/node-recovery"],
        coverage: [{ course_id: "infra", objective: "domain-1/ie-long-run-reliability" }],
      },
    ],
  ]);
  const q = (id, course_id, objective) => ({
    id,
    status: "published",
    course_id,
    domain: "domain-1",
    objective,
    stem: `Stem ${id}`,
    options: [
      { text: `Right ${id}`, correct: true },
      { text: `Wrong ${id}`, correct: false },
    ],
    evidence: [{ source_id: "src-shared", excerpt: `excerpt ${id}` }],
  });
  const questions = [
    q("ops-1", "ops", "domain-1/node-recovery"),
    q("ie-1", "infra", "domain-1/ie-long-run-reliability"),
    q("ie-off", "infra", "domain-1/ie-other"),
  ];
  const [ops, infra] = qualityReport({ courses, sources, questions });
  assert.deepEqual(ops.sourceObjectiveMismatches, []);
  assert.deepEqual(infra.sourceObjectiveMismatches, ["ie-off"]);
});
