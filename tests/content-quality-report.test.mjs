import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  qualityReport,
  itemCues,
  volatileKinds,
  isScenarioStem,
  nearDuplicates,
  parseAllowlist,
  loadAllowlist,
} from "../scripts/content-quality-report.mjs";

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

// --- fixtures for the new diagnostics ---------------------------------------

const COURSE = (id = "c1", objectives = ["topic", "other", "third"]) => ({
  id,
  domains: [
    { id: "domain-1", weight: 100, mock_questions: 1, objectives: objectives.map((o) => ({ id: o })) },
  ],
});

let seq = 0;
/** A balanced, unremarkable item: equal-length options, no cues. */
function item(overrides = {}) {
  seq += 1;
  const n = String(seq).padStart(3, "0");
  return {
    id: `q-${n}`,
    status: "published",
    course_id: "c1",
    domain: "domain-1",
    objective: "domain-1/topic",
    stem: `Which component holds the record ${n}?`,
    options: [
      { id: "a", text: `Alpha ledger keeps ${n}`, correct: true },
      { id: "b", text: `Bravo ledger keeps ${n}`, correct: false },
      { id: "c", text: `Delta ledger keeps ${n}`, correct: false },
      { id: "d", text: `Gamma ledger keeps ${n}`, correct: false },
    ],
    evidence: [{ source_id: `src-${n}`, excerpt: `unique excerpt number ${n}` }],
    ...overrides,
  };
}
const opts = (correct, ...distractors) => [
  { id: "a", text: correct, correct: true },
  ...distractors.map((text, i) => ({ id: "bcd"[i], text, correct: false })),
];
const run = (questions, extra = {}) =>
  qualityReport({ courses: new Map([["c1", COURSE()]]), sources: new Map(), questions, ...extra });

test("item cue: the correct option strictly longest is flagged, a tie is not", () => {
  const longest = itemCues(item({ options: opts("Longer correct text", "short a", "short b", "short c") }));
  assert.ok(longest.flags.some((f) => f.check === "correct-longest"));
  const tie = itemCues(item({ options: opts("same len", "same len", "abc", "abc") }));
  assert.ok(!tie.flags.some((f) => f.check === "correct-longest"));
});

test("course metric: correct-longest share warns above 45% and is strong above 60%", () => {
  const long = () =>
    item({ options: opts("a much longer correct option", "short one", "short two", "short three") });
  const warnOnly = run([long(), long(), item(), item()].concat([long()]).slice(0, 5)); // 3/5 = 60%
  const w1 = warnOnly[0].warnings.find((w) => w.check === "correct-longest");
  assert.equal(w1.level, "warn");
  const strong = run([long(), long(), long(), item()]); // 75%
  assert.equal(strong[0].warnings.find((w) => w.check === "correct-longest").level, "strong");
  const clean = run([long(), item(), item()]); // 33%
  assert.ok(!clean[0].warnings.some((w) => w.check === "correct-longest"));
});

test("length ratio: item flag above 1.5 and course warning when the mean exceeds 1.25", () => {
  const skewed = item({ options: opts("x".repeat(32), "y".repeat(20), "z".repeat(20), "w".repeat(20)) }); // 1.6
  const fine = item({ options: opts("x".repeat(28), "y".repeat(20), "z".repeat(20), "w".repeat(20)) }); // 1.4
  assert.equal(itemCues(skewed).flags.find((f) => f.check === "length-ratio")?.value, 1.6);
  assert.ok(!itemCues(fine).flags.some((f) => f.check === "length-ratio"));
  const [course] = run([skewed, fine]);
  assert.equal(course.metrics.meanLengthRatio, 1.5);
  assert.equal(course.metrics.lengthRatioItems, 1);
  assert.ok(course.warnings.some((w) => w.check === "length-ratio"));
  assert.ok(!run([item(), item()])[0].warnings.some((w) => w.check === "length-ratio"));
});

test("short distractor: a distractor under half the correct length flags the item and the course above 15%", () => {
  const shortOne = item({ options: opts("x".repeat(20), "y".repeat(9), "z".repeat(20), "w".repeat(20)) });
  const atHalf = item({ options: opts("x".repeat(20), "y".repeat(10), "z".repeat(20), "w".repeat(20)) });
  assert.deepEqual(itemCues(shortOne).flags.find((f) => f.check === "short-distractor").options, ["b"]);
  assert.ok(!itemCues(atHalf).flags.some((f) => f.check === "short-distractor"));
  assert.ok(run([shortOne, item(), item()])[0].warnings.some((w) => w.check === "short-distractor")); // 33%
  assert.ok(
    !run([shortOne, ...Array.from({ length: 6 }, () => item())])[0].warnings.some(
      (w) => w.check === "short-distractor",
    ),
  ); // 14%
});

test("absolutes: always/never/only in distractors but not in the correct option", () => {
  const cue = item({ options: opts("Retry with backoff", "Never retry at all", "Retry forever", "Drop it") });
  const both = item({
    options: opts("Only retry idempotent calls", "Never retry at all", "Retry forever", "Drop it"),
  });
  const substring = item({
    options: opts("Retry with backoff", "Use the onlyCache flag", "Retry forever", "Drop it"),
  });
  assert.ok(itemCues(cue).flags.some((f) => f.check === "absolute-only-in-distractors"));
  assert.ok(!itemCues(both).flags.some((f) => f.check === "absolute-only-in-distractors"));
  assert.ok(!itemCues(substring).flags.some((f) => f.check === "absolute-only-in-distractors"));
  assert.ok(run([cue, item()])[0].warnings.some((w) => w.check === "absolute-only-in-distractors")); // 50%
  assert.ok(!run([cue, item(), item()])[0].warnings.some((w) => w.check === "absolute-only-in-distractors")); // 33%
});

test("volatile facts: number+unit, version, CLI flag and price, but not API paths or bare numbers", () => {
  assert.deepEqual(volatileKinds("The timeout is 30 seconds"), ["number+unit"]);
  assert.deepEqual(volatileKinds("an 80 GB GPU"), ["number+unit"]);
  // `%` is a non-word character, so it cannot sit before a `\b`.
  assert.deepEqual(volatileKinds("99%"), ["number+unit"]);
  assert.deepEqual(volatileKinds("a 99.9% availability target"), ["number+unit"]);
  assert.deepEqual(volatileKinds("when 50% of replicas are ready"), ["number+unit"]);
  assert.deepEqual(volatileKinds("utilisation stays under 80 %"), ["number+unit"]);
  assert.deepEqual(volatileKinds("the share stays under 50%"), ["number+unit"]);
  assert.deepEqual(volatileKinds("a percentage of the replicas"), []);
  assert.deepEqual(volatileKinds("Upgrade to v2.1 of the SDK"), ["version"]);
  assert.deepEqual(volatileKinds("release 3.4.1"), ["version"]);
  assert.deepEqual(volatileKinds("pass `--max-depth` to the CLI"), ["cli-flag"]);
  assert.ok(volatileKinds("It costs $0.40 per call").includes("price"));
  // Same class as `%`: a currency symbol is a non-word character, so it must
  // lead the pattern rather than sit before a `\b`.
  for (const t of ["$5", "costs €0.40 an hour", "£3", "pay $ 12"]) {
    assert.ok(volatileKinds(t).includes("price"), t);
  }
  assert.deepEqual(volatileKinds("POST /v1/chat/completions"), []);
  assert.deepEqual(volatileKinds("send it to GET /v2"), []);
  assert.deepEqual(volatileKinds("the endpoint api.example.com/v2/search"), []);
  assert.deepEqual(volatileKinds("HTTP 429 means too many requests in a window"), []);
  const vol = item({ stem: "Which flag sets the limit to 100 tokens?" });
  assert.ok(run([vol, item(), item()])[0].warnings.some((w) => w.check === "volatile")); // 33%
  assert.ok(!run([vol, item(), item(), item()])[0].warnings.some((w) => w.check === "volatile")); // 25%
});

test("scenario share: crude classifier, warns below 35%", () => {
  assert.ok(isScenarioStem("A team wants to cut latency for its agent. Which setting should it change?"));
  assert.ok(isScenarioStem("Your pipeline returns empty results. What is the likely cause?"));
  assert.ok(!isScenarioStem("Which field holds the total credits?"));
  const scen = item({ stem: "A team notices its agent times out on long pages. What should it change?" });
  const recall = run([item(), item(), item()]);
  assert.equal(recall[0].metrics.scenarioShare, 0);
  assert.ok(recall[0].warnings.some((w) => w.check === "scenario-share"));
  assert.ok(!run([scen, item()])[0].warnings.some((w) => w.check === "scenario-share")); // 50%
});

test("excerpt reuse: the same normalised excerpt in two items is grouped, across courses too", () => {
  const a = item({ evidence: [{ source_id: "s1", excerpt: "Replicas  scale by POLICY." }] });
  const b = item({ evidence: [{ source_id: "s2", excerpt: "replicas scale by policy" }] });
  const [course] = run([a, b, item()]);
  assert.deepEqual(
    course.excerptReuse.map((g) => g.ids),
    [[a.id, b.id]],
  );
  assert.ok(course.warnings.some((w) => w.check === "excerpt-reuse"));
  // The original key is per source and unnormalised, and stays so.
  assert.deepEqual(course.repeatedCitations, []);
});

test("source concentration: one source above 20% of a course warns", () => {
  const shared = { source_id: "src-big", excerpt: "x" };
  const qs = [item(), item(), item(), item(), item()];
  qs[0] = { ...qs[0], evidence: [shared] };
  assert.ok(!run(qs)[0].warnings.some((w) => w.check === "source-share")); // 1/5 = 20%
  qs[1] = { ...qs[1], evidence: [{ ...shared, excerpt: "y" }] };
  const [course] = run(qs); // 2/5 = 40%
  assert.deepEqual(course.sourceShares[0], { source_id: "src-big", items: 2, share: 0.4 });
  assert.ok(course.warnings.some((w) => w.check === "source-share" && /src-big/.test(w.message)));
});

test("objective coverage: under 3 is thin, 0 is missing and flagged separately", () => {
  const qs = [item(), item(), item(), item({ objective: "domain-1/other" })];
  const [course] = run(qs);
  assert.deepEqual(
    course.objectiveCoverage.map((o) => [o.objective, o.items, o.status]),
    [
      ["domain-1/topic", 3, "ok"],
      ["domain-1/other", 1, "thin"],
      ["domain-1/third", 0, "missing"],
    ],
  );
  assert.deepEqual(
    course.warnings.filter((w) => w.check.startsWith("objective-")).map((w) => w.check),
    ["objective-thin", "objective-missing"],
  );
});

// --- near-duplicates ---------------------------------------------------------

const dupA = () =>
  item({
    id: "q-dup-a",
    stem: "How is each available tool described to the model?",
    options: opts(
      "With a JSON Schema giving its name, parameters and data types",
      "With an OpenAPI document that is referenced by its URL here",
      "With a Python type signature introspected from the callable",
      "With a natural-language description in the system prompt",
    ),
  });
const dupB = (course_id = "c2") =>
  item({
    id: "q-dup-b",
    course_id,
    stem: "How is each available tool described to the model?",
    options: opts(
      "As a JSON Schema giving its name, input parameters and data types",
      "As a natural-language sentence placed into the system prompt",
      "As an example request and response pair shown to the model",
      "As a URL that the model calls directly whenever it needs the tool",
    ),
  });
const filler = () => [
  item({ stem: "Which region hosts the managed vector database?" }),
  item({ stem: "What triggers an autoscaling event for inference replicas?" }),
  item({ stem: "Where are audit logs for the project retained?" }),
];

test("near-duplicates are found across courses with TF-IDF cosine and labelled cross-course", () => {
  const corpus = [dupA(), dupB("c2"), ...filler()];
  const pairs = nearDuplicates(corpus);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].ids, ["q-dup-a", "q-dup-b"]);
  assert.equal(pairs[0].relation, "cross-course");
  assert.ok(pairs[0].cosine >= 0.6);
  const same = nearDuplicates([dupA(), dupB("c1"), ...filler()]);
  assert.equal(same[0].relation, "same-course");
  // The per-course report lists a cross-course pair under both courses.
  const courses = new Map([
    ["c1", COURSE("c1")],
    ["c2", COURSE("c2")],
  ]);
  const report = qualityReport({ courses, sources: new Map(), questions: corpus });
  assert.equal(report[0].nearDuplicates.length, 1);
  assert.equal(report[1].nearDuplicates.length, 1);
});

test("near-duplicates: vendor names and stopwords do not create similarity, key-term overlap rescues a mid cosine", () => {
  const v1 = item({
    stem: "Per the Nebius docs, which Tavily setting applies?",
    options: opts("alpha", "b", "c", "d"),
  });
  const v2 = item({
    stem: "According to Nebius and Tavily docs, what should apply?",
    options: opts("omega", "b", "c", "d"),
  });
  assert.deepEqual(nearDuplicates([v1, v2, ...filler()]), []);
  // Different framing, same key terms in the correct option.
  const k1 = item({
    stem: "An operator restarts a stalled training run. Which checkpoint data restores progress?",
    options: opts("Resume from the latest checkpoint shard manifest", "b", "c", "d"),
  });
  const k2 = item({
    stem: "Which checkpoint data lets a crashed job continue where it stopped?",
    options: opts("Load the latest checkpoint shard manifest", "b", "c", "d"),
  });
  const [pair] = nearDuplicates([k1, k2, ...filler()]);
  assert.ok(pair, "expected the key-term rule to flag the pair");
  assert.ok(pair.cosine >= 0.4 && pair.cosine < 0.6, `cosine ${pair.cosine}`);
  assert.ok(pair.keyOverlap >= 0.8);
});

test("allowlist marks an intentional contrast pair, keeps it visible and stops it counting as a warning", () => {
  const allowlist = parseAllowlist({ pairs: [{ pair: ["q-dup-b", "q-dup-a"], reason: "contrast" }] });
  const courses = new Map([["c1", COURSE("c1")]]);
  const questions = [dupA(), dupB("c1"), ...filler()];
  const [listed] = qualityReport({ courses, sources: new Map(), questions, allowlist });
  assert.equal(listed.nearDuplicates[0].allowlisted, "contrast");
  assert.ok(!listed.warnings.some((w) => w.check === "near-duplicate"));
  const [unlisted] = qualityReport({ courses, sources: new Map(), questions });
  assert.ok(unlisted.warnings.some((w) => w.check === "near-duplicate"));
});

test("a malformed allowlist throws instead of reading as empty; a missing file is empty", () => {
  assert.throws(() => parseAllowlist({ pairs: [{ pair: ["q-a"], reason: "x" }] }), /two distinct/);
  assert.throws(() => parseAllowlist({ pairs: [{ pair: ["q-a", "q-a"], reason: "x" }] }), /two distinct/);
  assert.throws(() => parseAllowlist({ pairs: [{ pair: ["q-a", "q-b"] }] }), /reason/);
  assert.throws(() => parseAllowlist({ pairs: [{ pair: ["q-a", "q-b"], reason: "   " }] }), /reason/);
  assert.throws(() => parseAllowlist([{ pair: ["q-a", "q-b"], reason: "x" }]), /pairs/);
  assert.throws(() => parseAllowlist(null), /pairs/);
  const dir = mkdtempSync(join(tmpdir(), "quality-allowlist-"));
  try {
    assert.equal(loadAllowlist(dir).size, 0);
    writeFileSync(join(dir, "quality-allowlist.yaml"), "pairs:\n  - pair: [q-a]\n    reason: x\n");
    assert.throws(() => loadAllowlist(dir), /two distinct/);
    // Genuinely empty or comment-only: an empty allowlist.
    writeFileSync(join(dir, "quality-allowlist.yaml"), "");
    assert.equal(loadAllowlist(dir).size, 0);
    writeFileSync(join(dir, "quality-allowlist.yaml"), "# nothing allowlisted yet\n\n  # still nothing\n");
    assert.equal(loadAllowlist(dir).size, 0);
    // Other documents that parse to null are malformed, not empty.
    for (const text of ["~\n", "null\n", "---\n", "# header\n---\n"]) {
      writeFileSync(join(dir, "quality-allowlist.yaml"), text);
      assert.throws(() => loadAllowlist(dir), /pairs/, JSON.stringify(text));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- candidate scope ---------------------------------------------------------

test("candidate scope scores review_ready items against the published bank", () => {
  const bank = [dupA(), ...filler()];
  const candidate = { ...dupB("c1"), status: "review_ready" };
  const other = item({
    status: "review_ready",
    options: opts("a much longer correct option", "s1", "s2", "s3"),
  });
  const draft = item({ status: "needs_review" });
  const questions = [...bank, candidate, other, draft];
  const [published] = run(questions);
  assert.equal(published.scope, "published");
  assert.equal(published.metrics.items, 4);
  assert.deepEqual(published.nearDuplicates, []);

  const [cand] = run(questions, { scope: "candidates" });
  assert.equal(cand.scope, "candidates");
  assert.deepEqual(cand.scored.sort(), [candidate.id, other.id].sort());
  assert.equal(cand.bankItems, 6);
  assert.deepEqual(
    cand.nearDuplicates.map((p) => p.ids),
    [["q-dup-a", "q-dup-b"]],
  );
  assert.deepEqual(
    cand.itemFlags.map((f) => f.id),
    [other.id],
  );
  // Original keys still describe the published bank.
  assert.equal(cand.published, 4);

  const [only] = run(questions, { scope: "candidates", ids: [other.id] });
  assert.deepEqual(only.scored, [other.id]);
  assert.deepEqual(only.nearDuplicates, []);
  assert.throws(() => run(questions, { scope: "candidates", ids: [draft.id] }), /not review_ready/);
  assert.throws(() => run(questions, { scope: "candidates", ids: ["q-nope"] }), /not review_ready/);
  assert.throws(() => run(questions, { scope: "everything" }), /unknown scope/);
});

test("published scope ignores pairs that only involve non-published items", () => {
  const questions = [
    { ...dupA(), status: "review_ready" },
    { ...dupB("c1"), status: "review_ready" },
    ...filler(),
  ];
  assert.deepEqual(run(questions)[0].nearDuplicates, []);
});

test("candidate scope does not re-report pairs that lie entirely inside the published bank", () => {
  const questions = [dupA(), dupB("c1"), ...filler(), item({ status: "review_ready" })];
  assert.equal(run(questions)[0].nearDuplicates.length, 1);
  assert.deepEqual(run(questions, { scope: "candidates" })[0].nearDuplicates, []);
});

test("excerpt reuse is per course; reuse across a course boundary is an informational count, not a warning", () => {
  const ev = (excerpt) => [{ source_id: "s1", excerpt }];
  const a = item({ evidence: ev("shared within the course") });
  const b = item({ evidence: ev("Shared within the course.") });
  const x = item({ evidence: ev("shared across courses") });
  const y = item({ course_id: "c2", evidence: ev("shared across courses") });
  const courses = new Map([
    ["c1", COURSE("c1")],
    ["c2", COURSE("c2")],
  ]);
  const [c1, c2] = qualityReport({ courses, sources: new Map(), questions: [a, b, x, y] });
  assert.deepEqual(
    c1.excerptReuse.map((g) => g.ids),
    [[a.id, b.id]],
  );
  assert.equal(c1.warnings.filter((w) => w.check === "excerpt-reuse").length, 1);
  assert.equal(c1.crossCourseExcerptReuseCount, 1);
  assert.deepEqual(c1.crossCourseExcerptReuse[0].courses, ["c1", "c2"]);
  assert.deepEqual(c2.excerptReuse, []);
  assert.ok(!c2.warnings.some((w) => w.check === "excerpt-reuse"));
  assert.equal(c2.crossCourseExcerptReuseCount, 1);
  // Two in one course plus one elsewhere: a warning for the pair, info for the crossing.
  const z = item({ course_id: "c2", evidence: ev("shared within the course") });
  const [d1, d2] = qualityReport({ courses, sources: new Map(), questions: [a, b, z] });
  assert.deepEqual(
    d1.excerptReuse.map((g) => g.ids),
    [[a.id, b.id]],
  );
  assert.equal(d1.crossCourseExcerptReuseCount, 1);
  assert.deepEqual(d2.excerptReuse, []);
});

test("candidate scope computes course metrics on the after state and keeps the published before state", () => {
  const long = (status) =>
    item({ status, options: opts("a much longer correct option", "short one", "short two", "short three") });
  const bank = [item(), item(), item(), item()];
  const candidate = long("review_ready");
  const courses = new Map([
    ["c1", COURSE("c1")],
    ["c2", COURSE("c2")],
  ]);
  const quiet = [item({ course_id: "c2" }), item({ course_id: "c2" })]; // scenario share 0, thin objectives
  const [c1, c2] = qualityReport({
    courses,
    sources: new Map(),
    questions: [...bank, candidate, ...quiet],
    scope: "candidates",
  });
  assert.deepEqual(c1.scored, [candidate.id]);
  assert.equal(c1.metrics.items, 5);
  assert.equal(c1.metrics.correctLongestShare, 0.2);
  assert.equal(c1.metricsBefore.items, 4);
  assert.equal(c1.metricsBefore.correctLongestShare, 0);
  // On the candidate sample alone this would be 100%, a strong warning.
  assert.ok(!c1.warnings.some((w) => w.check === "correct-longest"));
  assert.deepEqual(
    c1.itemFlags.map((f) => f.id),
    [candidate.id],
  );
  // A course without candidates reports its numbers but raises no course-level warnings.
  assert.equal(c2.metrics.items, 2);
  assert.deepEqual(c2.warnings, []);
  // Published scope: before and after are the same population.
  const [p1] = run([...bank, candidate]);
  assert.deepEqual(p1.metrics, p1.metricsBefore);
});

test("the scenario share is labelled crude and advisory in the JSON", () => {
  const [course] = run([item(), item()]);
  assert.match(course.metrics.scenarioShareNote, /crude, advisory/);
  const w = course.warnings.find((x) => x.check === "scenario-share");
  assert.equal(w.level, "advisory");
  assert.match(w.message, /crude classifier, advisory/);
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

test("in candidate scope a course's own excerpt group must contain a candidate to warn", () => {
  const ev = [{ source_id: "s1", excerpt: "one excerpt everywhere" }];
  const p1 = item({ evidence: ev });
  const p2 = item({ evidence: ev });
  const k = item({ course_id: "c2", status: "review_ready", evidence: ev });
  const courses = new Map([
    ["c1", COURSE("c1")],
    ["c2", COURSE("c2")],
  ]);
  const questions = [p1, p2, k];
  const [c1, c2] = qualityReport({ courses, sources: new Map(), questions, scope: "candidates" });
  assert.deepEqual(c1.excerptReuse, []);
  assert.ok(!c1.warnings.some((w) => w.check === "excerpt-reuse"));
  // The crossing is still visible, as information, on both sides.
  assert.equal(c1.crossCourseExcerptReuseCount, 1);
  assert.equal(c2.crossCourseExcerptReuseCount, 1);
  // A candidate inside c1 does make it c1's finding.
  const k1 = item({ status: "review_ready", evidence: ev });
  const [d1] = qualityReport({ courses, sources: new Map(), questions: [p1, p2, k1], scope: "candidates" });
  assert.deepEqual(
    d1.excerptReuse.map((g) => g.ids),
    [[p1.id, p2.id, k1.id].sort()],
  );
  // Published scope is unchanged: every item is scored.
  const [e1] = qualityReport({ courses, sources: new Map(), questions });
  assert.equal(e1.excerptReuse.length, 1);
});
