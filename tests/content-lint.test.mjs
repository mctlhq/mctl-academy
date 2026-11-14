/**
 * The content lint is the gate that everything else in this project leans on,
 * so each rule gets a test that proves it actually rejects — not just that a
 * good file passes.
 *
 * Fixtures are built in a temp directory rather than committed, so each case
 * states the rule it exercises right next to the assertion.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { questionFingerprint } from "../scripts/lib/question-review.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const LINT = join(ROOT, "scripts", "validate-content.mjs");

const COURSE_DEF = {
  schema_version: 1,
  id: "agentic-ai-builder",
  prepares_for: "Test Course",
  title: "Test",
  description: "Test description for course map",
  mock: { question_count: 30, time_limit_minutes: 60 },
  domains: [
    {
      id: "domain-1",
      title: "One",
      weight: 20,
      mock_questions: 6,
      objectives: [{ id: "alpha", title: "Alpha" }],
    },
    {
      id: "domain-2",
      title: "Two",
      weight: 35,
      mock_questions: 10,
      objectives: [{ id: "beta", title: "Beta" }],
    },
    {
      id: "domain-3",
      title: "Three",
      weight: 20,
      mock_questions: 6,
      objectives: [{ id: "gamma", title: "Gamma" }],
    },
    {
      id: "domain-4",
      title: "Four",
      weight: 25,
      mock_questions: 8,
      objectives: [{ id: "delta", title: "Delta" }],
    },
  ],
};

const HASH = "a".repeat(64);

const source = (over = {}) => ({
  schema_version: 1,
  id: "src-docs-agents",
  url: "https://docs.nebius.com/agents",
  title: "Agents",
  retrieved_at: "2026-08-06T10:00:00Z",
  sha256: HASH,
  objectives: ["domain-1/alpha"],
  snapshot: { bucket: "academy-source-snapshots", key: HASH },
  ...over,
});

const option = (id, correct, text) => ({
  id,
  text,
  correct,
  explanation: `Explanation for option ${id} that is long enough.`,
});

const question = (over = {}) => ({
  schema_version: 1,
  id: "q-abcdef123456",
  course_id: "agentic-ai-builder",
  status: "published",
  domain: "domain-1",
  objective: "domain-1/alpha",
  stem: "Which statement about agents is correct?",
  options: [
    option("a", true, "The correct one"),
    option("b", false, "A wrong one"),
    option("c", false, "Another wrong one"),
    option("d", false, "A third wrong one"),
  ],
  evidence: [
    { source_id: "src-docs-agents", source_sha256: HASH, excerpt: "agents run tools on your behalf" },
  ],
  authored: { by: "agent:writer", at: "2026-08-06T10:00:00Z" },
  reviewed: { by: "mashkovd", at: "2026-08-06T11:00:00Z" },
  ...over,
});

/**
 * Runs the lint against a fixture tree. Returns { ok, output }.
 *
 * @param {{ sources?: any[], questions?: any[], receipts?: any[],
 *           coverage?: any[], manifest?: any, courseDef?: any }} fixture
 */
function lint({
  sources = [source()],
  questions = [question()],
  receipts = [],
  coverage = [],
  manifest,
  courseDef = COURSE_DEF,
}) {
  const dir = mkdtempSync(join(tmpdir(), "academy-lint-"));
  try {
    mkdirSync(join(dir, "courses"), { recursive: true });
    mkdirSync(join(dir, "sources"), { recursive: true });
    mkdirSync(join(dir, "questions"), { recursive: true });
    mkdirSync(join(dir, "reviews"), { recursive: true });
    receipts.forEach((r, i) => writeFileSync(join(dir, "reviews", `r${i}-review.json`), JSON.stringify(r)));
    writeFileSync(join(dir, "courses", "agentic-ai-builder.yaml"), JSON.stringify(courseDef));
    sources.forEach((s, i) => writeFileSync(join(dir, "sources", `s${i}.yaml`), JSON.stringify(s)));
    questions.forEach((q, i) => writeFileSync(join(dir, "questions", `q${i}.yaml`), JSON.stringify(q)));
    if (coverage.length) mkdirSync(join(dir, "coverage"), { recursive: true });
    // A string is written as-is, so a test can hand the lint unparseable YAML.
    coverage.forEach((c, i) =>
      writeFileSync(
        join(dir, "coverage", typeof c === "string" ? `bad${i}.yaml` : `${c.course_id}.yaml`),
        typeof c === "string" ? c : JSON.stringify(c),
      ),
    );
    if (manifest !== undefined) {
      writeFileSync(
        join(dir, "capture-manifest.yaml"),
        typeof manifest === "string" ? manifest : JSON.stringify(manifest),
      );
    }

    try {
      const out = execFileSync("node", [LINT], {
        env: { ...process.env, ACADEMY_CONTENT_DIR: dir, ACADEMY_REVIEW_DIR: join(dir, "reviews") },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true, output: out };
    } catch (e) {
      return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a well-formed question passes", () => {
  const { ok, output } = lint({});
  assert.equal(ok, true, output);
});

test("rejects two correct answers", () => {
  const q = question();
  q.options[1].correct = true;
  const { ok, output } = lint({ questions: [q] });
  assert.equal(ok, false);
  assert.match(output, /options/);
});

test("rejects zero correct answers", () => {
  const q = question();
  q.options[0].correct = false;
  const { ok } = lint({ questions: [q] });
  assert.equal(ok, false);
});

test("rejects an excerpt longer than 25 words", () => {
  const q = question({
    evidence: [
      {
        source_id: "src-docs-agents",
        source_sha256: HASH,
        excerpt: Array.from({ length: 26 }, (_, i) => `w${i}`).join(" "),
      },
    ],
  });
  const { ok, output } = lint({ questions: [q] });
  assert.equal(ok, false);
  assert.match(output, /excerpt/);
});

test("accepts an excerpt of exactly 25 words", () => {
  const q = question({
    evidence: [
      {
        source_id: "src-docs-agents",
        source_sha256: HASH,
        excerpt: Array.from({ length: 25 }, (_, i) => `w${i}`).join(" "),
      },
    ],
  });
  const { ok, output } = lint({ questions: [q] });
  assert.equal(ok, true, output);
});

test("rejects publication without review", () => {
  const q = question();
  delete q.reviewed;
  const { ok, output } = lint({ questions: [q] });
  assert.equal(ok, false);
  assert.match(output, /approval is not optional/);
});

test("an agent approval needs a committed receipt for that exact revision", () => {
  const q = question({
    reviewed: { by: "agent:reviewer", at: "2026-09-06T10:00:00Z", content_sha256: HASH },
  });
  // The fingerprint is checked by reviewProblems (stale => bundle-ineligible);
  // here the receipt binding is what is under test, so stamp the real one.
  q.reviewed.content_sha256 = questionFingerprint(q);
  const receipt = (over = {}) => ({
    reviewer: "agent:reviewer",
    questions: [{ id: q.id, content_sha256: q.reviewed.content_sha256, approved: true, ...over }],
  });
  assert.equal(lint({ questions: [q], receipts: [receipt()] }).ok, true);
  const missing = lint({ questions: [q] });
  assert.equal(missing.ok, false);
  assert.match(missing.output, /without a committed review receipt/);
  const rejected = lint({ questions: [q], receipts: [receipt({ approved: false })] });
  assert.equal(rejected.ok, false);
  assert.match(rejected.output, /not an approval/);
  const otherRevision = lint({ questions: [q], receipts: [receipt({ content_sha256: "b".repeat(64) })] });
  assert.equal(otherRevision.ok, false);
  assert.match(otherRevision.output, /different revision/);
  const otherReviewer = lint({
    questions: [q],
    receipts: [{ ...receipt(), reviewer: "agent:someone-else" }],
  });
  assert.equal(otherReviewer.ok, false);
});

test("a human approval stamped from 2026-09-06 must carry the content fingerprint", () => {
  const stale = question({ reviewed: { by: "mashkovd", at: "2026-09-06T10:00:00Z" } });
  const result = lint({ questions: [stale] });
  assert.equal(result.ok, false);
  assert.match(result.output, /require content_sha256/);
  const legacy = question({ reviewed: { by: "mashkovd", at: "2026-09-05T23:59:59Z" } });
  assert.equal(lint({ questions: [legacy] }).ok, true);
});

test("rejects an authored.at in the future, before the batch promotion can throw on it", () => {
  // The author agent guesses the time of day. reviewProblems refuses an
  // approval that predates what it approves, so a forward timestamp would kill
  // the entire promotion batch after the branch was already pushed. The lint
  // runs before that push, so this is where it has to be caught.
  const ahead = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const q = question({ authored: { by: "agent:writer", at: ahead } });
  const { ok, output } = lint({ questions: [q] });
  assert.equal(ok, false);
  assert.match(output, /is in the future/);

  // A timestamp half a minute ahead is clock skew, not a guess, and stays
  // accepted. Reviewed as review_ready: a published fixture carries an August
  // approval, which the ordering rule would refuse against a today timestamp.
  const skew = new Date(Date.now() + 30_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const fresh = question({
    status: "review_ready",
    reviewed: undefined,
    authored: { by: "agent:writer", at: skew },
  });
  assert.equal(lint({ questions: [fresh] }).ok, true);
});

test("rejects a human as item author — clean-room separation", () => {
  const q = question({ authored: { by: "mashkovd", at: "2026-08-06T10:00:00Z" } });
  const { ok, output } = lint({ questions: [q] });
  assert.equal(ok, false);
  assert.match(output, /CONTENT-POLICY/);
});

test("rejects duplicate option text", () => {
  const q = question();
  q.options[2].text = q.options[1].text;
  const { ok, output } = lint({ questions: [q] });
  assert.equal(ok, false);
  assert.match(output, /same text/);
});

test("rejects a citation to an unknown source", () => {
  const q = question({
    evidence: [{ source_id: "src-does-not-exist", source_sha256: HASH, excerpt: "nope" }],
  });
  const { ok, output } = lint({ questions: [q] });
  assert.equal(ok, false);
  assert.match(output, /unknown source/);
});

test("rejects publication when the source has no snapshot to verify against", () => {
  const s = source();
  delete s.snapshot;
  const { ok, output } = lint({ sources: [s] });
  assert.equal(ok, false);
  assert.match(output, /no snapshot/);
});

test("rejects publication against a drifted source", () => {
  const { ok, output } = lint({ sources: [source({ status: "drifted" })] });
  assert.equal(ok, false);
  assert.match(output, /drifted/);
});

test("rejects publication against a deprecated source", () => {
  const { ok, output } = lint({ sources: [source({ status: "deprecated" })] });
  assert.equal(ok, false);
  assert.match(output, /deprecated/);
});

test("allows a needs_review question to cite a drifted source", () => {
  // needs_review is exactly the state a question is moved to when its source
  // drifts, so the lint must accept it — it just never reaches the bundle.
  const { ok, output } = lint({
    sources: [source({ status: "drifted" })],
    questions: [question({ status: "needs_review" })],
  });
  assert.equal(ok, true, output);
});

test("allows a draft to cite a source with no snapshot", () => {
  const s = source();
  delete s.snapshot;
  const { ok, output } = lint({ sources: [s], questions: [question({ status: "draft" })] });
  assert.equal(ok, true, output);
});

test("rejects an objective that does not belong to its domain", () => {
  const { ok, output } = lint({ questions: [question({ objective: "domain-2/beta" })] });
  assert.equal(ok, false);
  assert.match(output, /does not belong/);
});

test("rejects a host that is not on the allowlist", () => {
  const { ok, output } = lint({ sources: [source({ url: "https://example.com/agents" })] });
  assert.equal(ok, false);
  assert.match(output, /allowlist/);
});

test("accepts a page inside the LeRobot docs tree", () => {
  const s = source({ url: "https://huggingface.co/docs/lerobot/il_robots.md" });
  const { ok, output } = lint({ sources: [s] });
  assert.equal(ok, true, output);
});

test("accepts Tavily API, SDK, best-practice and example pages", () => {
  for (const url of [
    "https://docs.tavily.com/agents.md",
    "https://docs.tavily.com/documentation/rate-limits.md",
    "https://docs.tavily.com/documentation/api-reference/endpoint/search.md",
    "https://docs.tavily.com/documentation/best-practices/api-key-management.md",
    "https://docs.tavily.com/sdk/python/reference.md",
    "https://docs.tavily.com/examples/quick-tutorials/crawl-api.md",
  ]) {
    const { ok, output } = lint({ sources: [source({ url })] });
    assert.equal(ok, true, `${url}\n${output}`);
  }
});

// docs.tavily.com is allowlisted for its own API documentation only; the
// third-party integration and partnership pages were never reviewed.
test("rejects Tavily pages outside the reviewed scope", () => {
  for (const url of [
    "https://docs.tavily.com/documentation/integrations/langchain.md",
    "https://docs.tavily.com/documentation/partnerships/azure.md",
    "https://docs.tavily.com/documentation/machine-payments/x402.md",
    "https://docs.tavily.com/documentation/integrations.md",
    "https://docs.tavily.com/documentation/partnerships.md",
    "https://docs.tavily.com/documentation/machine-payments.md",
    "https://docs.tavily.com/documentation/api-reference/../integrations/openai.md",
    "https://docs.tavily.com/changelog.md",
    "https://docs.tavily.com/documentation/api-reference/openapi.json",
    "https://docs.tavily.com/llms-full.txt",
    "https://app.tavily.com/playground",
    "https://tavily.com/blog",
  ]) {
    const { ok, output } = lint({ sources: [source({ url })] });
    assert.equal(ok, false, url);
    assert.match(output, /allowlist/);
  }
});

// huggingface.co is allowlisted for one path prefix only; the rest of the
// host (other libraries' docs, model cards, the blog) was never reviewed.
test("rejects a page on an allowlisted host but outside its path prefix", () => {
  for (const url of [
    "https://huggingface.co/docs/transformers/index.md",
    "https://huggingface.co/docs/lerobot/../transformers/index.md",
    "https://huggingface.co/docs/lerobotx/index.md",
    "https://huggingface.co/blog/lerobot",
  ]) {
    const { ok, output } = lint({ sources: [source({ url })] });
    assert.equal(ok, false, url);
    assert.match(output, /allowlist/);
  }
});

const NPA_SHA = "8195442868f877cbd933eaeecd23b765974de20f";
const NPA = `https://raw.githubusercontent.com/nebius/nebius-physical-ai/${NPA_SHA}/docs`;

test("accepts a nebius-physical-ai guide or cookbook pinned to a commit", () => {
  for (const url of [
    `${NPA}/workbench/guides/digital-twin.md`,
    `${NPA}/workbench/cookbooks/public-vla-training.md`,
    `${NPA}/workbench/composing-cloud-and-token-factory.md`,
    `${NPA}/quickstart.md`,
  ]) {
    const { ok, output } = lint({ sources: [source({ url })] });
    assert.equal(ok, true, `${url}\n${output}`);
  }
});

// The repository is allowlisted only at an immutable commit and only for its
// guide and cookbook pages: a branch ref moves under a recorded hash, and the
// same tree holds run evidence, dated results and internal plans.
test("rejects nebius-physical-ai pages off a pinned commit or outside the guides", () => {
  for (const url of [
    "https://raw.githubusercontent.com/nebius/nebius-physical-ai/main/docs/quickstart.md",
    `https://raw.githubusercontent.com/nebius/nebius-physical-ai/${NPA_SHA.slice(0, 12)}/docs/quickstart.md`,
    `${NPA}/architecture/evidence/token-factory-sdg/report.json`,
    `${NPA}/workbench/behavior-experiment-results-2026-09-17.md`,
    `${NPA}/workbench/cookbooks/byof-isaac-lab/README.md`,
    `${NPA}/workbench/guides/../../../README.md`,
    `https://raw.githubusercontent.com/nebius/other-repo/${NPA_SHA}/docs/quickstart.md`,
    `https://github.com/nebius/nebius-physical-ai/blob/${NPA_SHA}/docs/quickstart.md`,
  ]) {
    const { ok, output } = lint({ sources: [source({ url })] });
    assert.equal(ok, false, url);
    assert.match(output, /allowlist/);
  }
});

test("accepts the Token Factory docs host", () => {
  const s = source({ url: "https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling" });
  const { ok, output } = lint({ sources: [s] });
  assert.equal(ok, true, output);
});

// Live only once a course file has a populated objective map — before that the
// check short-circuits, so it went untested until the outline landed.
// Regression: the first 20 authored questions all put the correct answer in
// position a. Runtime shuffling hid it in the product, so only a corpus-level
// check catches it.
test("rejects a bank where one answer position dominates", () => {
  const questions = Array.from({ length: 12 }, (_, i) =>
    question({ id: `q-aaaaaaaaaa${i.toString(36)}${i.toString(36)}` }),
  );
  const { ok, output } = lint({ questions });
  assert.equal(ok, false);
  assert.match(output, /correct answers are in position/);
});

test("accepts a bank with varied answer positions", () => {
  const questions = Array.from({ length: 12 }, (_, i) => {
    const q = question({ id: `q-bbbbbbbbbb${i.toString(36)}${i.toString(36)}` });
    const target = i % 4;
    q.options = q.options.map((o, j) => ({ ...o, correct: j === target }));
    return q;
  });
  const { ok, output } = lint({ questions });
  assert.equal(ok, true, output);
});

test("rejects an objective absent from the course map", () => {
  const q = question({ objective: "domain-1/not-a-real-objective" });
  const { ok, output } = lint({ questions: [q] });
  assert.equal(ok, false);
  assert.match(output, /not defined in course/);
});

test("rejects a snapshot key that does not match the source hash", () => {
  const s = source({ snapshot: { bucket: "academy-source-snapshots", key: "b".repeat(64) } });
  const { ok, output } = lint({ sources: [s] });
  assert.equal(ok, false);
  assert.match(output, /keyed by content hash/);
});

test("duplicate receipt entries for one question poison the key instead of last-write-wins", () => {
  const q = question({
    reviewed: { by: "agent:reviewer", at: "2026-09-06T10:00:00Z", content_sha256: HASH },
  });
  q.reviewed.content_sha256 = questionFingerprint(q);
  const entry = (approved) => ({ id: q.id, content_sha256: q.reviewed.content_sha256, approved });
  // A rejection followed by an approval must not resolve to the approval,
  // whether the two entries share a file or sit in two files.
  const inOneFile = lint({
    questions: [q],
    receipts: [{ reviewer: "agent:reviewer", questions: [entry(false), entry(true)] }],
  });
  assert.equal(inOneFile.ok, false);
  assert.match(inOneFile.output, /more than one receipt entry/);
  const acrossFiles = lint({
    questions: [q],
    receipts: [
      { reviewer: "agent:reviewer", questions: [entry(false)] },
      { reviewer: "agent:reviewer", questions: [entry(true)] },
    ],
  });
  assert.equal(acrossFiles.ok, false);
  assert.match(acrossFiles.output, /more than one receipt entry/);
});

// ------------------------------------------------------------ coverage plans

const covObjective = (id, over = {}) => ({
  id,
  status: "open",
  strength: "strong",
  volatile: false,
  note: "Documented end to end.",
  sources: [{ url: "https://docs.nebius.com/agents", existing: "src-docs-agents" }],
  ...over,
});

const coveragePlan = (over = {}) => ({
  schema_version: 1,
  course_id: "agentic-ai-builder",
  reviewed_at: "2026-11-14",
  objectives: ["domain-1/alpha", "domain-2/beta", "domain-3/gamma", "domain-4/delta"].map((id) =>
    covObjective(id),
  ),
  ...over,
});

const withObjectives = (mutate) => {
  const plan = coveragePlan();
  plan.objectives = mutate(plan.objectives);
  return plan;
};

test("a coverage plan listing every objective once passes", () => {
  const { ok, output } = lint({ coverage: [coveragePlan()] });
  assert.equal(ok, true, output);
});

test("rejects a coverage plan that leaves an objective out", () => {
  const { ok, output } = lint({ coverage: [withObjectives((o) => o.slice(0, 3))] });
  assert.equal(ok, false);
  assert.match(output, /objective domain-4\/delta of agentic-ai-builder is missing/);
});

test("rejects a coverage objective the course map does not define", () => {
  const { ok, output } = lint({
    coverage: [withObjectives((o) => [...o, covObjective("domain-1/omega")])],
  });
  assert.equal(ok, false);
  assert.match(output, /objective domain-1\/omega is not in course agentic-ai-builder/);
});

test("rejects a coverage objective listed twice", () => {
  const { ok, output } = lint({ coverage: [withObjectives((o) => [...o, covObjective("domain-1/alpha")])] });
  assert.equal(ok, false);
  assert.match(output, /domain-1\/alpha is listed more than once/);
});

test("rejects coverage for an unknown course", () => {
  const { ok, output } = lint({ coverage: [coveragePlan({ course_id: "no-such-course" })] });
  assert.equal(ok, false);
  assert.match(output, /references unknown course no-such-course/);
});

test("rejects a malformed or unparseable coverage file instead of skipping it", () => {
  const missingNote = withObjectives((o) => [{ ...o[0], note: undefined }, ...o.slice(1)]);
  delete missingNote.objectives[0].note;
  for (const coverage of [
    [missingNote],
    [coveragePlan({ objectives: "all" })],
    ["objectives: [\n"],
    ["null"],
  ]) {
    const { ok } = lint({ coverage });
    assert.equal(ok, false, JSON.stringify(coverage));
  }
});

test("rejects an open objective with no source, and a missing one left open", () => {
  let r = lint({ coverage: [withObjectives((o) => [{ ...o[0], sources: [] }, ...o.slice(1)])] });
  assert.equal(r.ok, false);
  r = lint({
    coverage: [withObjectives((o) => [{ ...o[0], strength: "missing", sources: [] }, ...o.slice(1)])],
  });
  assert.equal(r.ok, false);
  r = lint({
    coverage: [
      withObjectives((o) => [{ ...o[0], status: "held", strength: "missing", sources: [] }, ...o.slice(1)]),
    ],
  });
  assert.equal(r.ok, true, r.output);
});

test("rejects a coverage URL off the allowlist", () => {
  const { ok, output } = lint({
    coverage: [
      withObjectives((o) => [{ ...o[0], sources: [{ url: "https://example.com/a.md" }] }, ...o.slice(1)]),
    ],
  });
  assert.equal(ok, false);
  assert.match(output, /example\.com\/a\.md is not on the SOURCES\.md allowlist/);
});

test("rejects an `existing` id that is unknown or names a different page", () => {
  let r = lint({
    coverage: [
      withObjectives((o) => [
        { ...o[0], sources: [{ url: "https://docs.nebius.com/agents", existing: "src-nope" }] },
        ...o.slice(1),
      ]),
    ],
  });
  assert.equal(r.ok, false);
  assert.match(r.output, /existing source src-nope does not exist/);
  r = lint({
    coverage: [
      withObjectives((o) => [
        { ...o[0], sources: [{ url: "https://docs.nebius.com/other.md", existing: "src-docs-agents" }] },
        ...o.slice(1),
      ]),
    ],
    manifest: { sources: [] },
  });
  assert.equal(r.ok, false);
  assert.match(r.output, /src-docs-agents is https:\/\/docs\.nebius\.com\/agents, not/);
});

test("a new coverage URL must be planned in the capture manifest", () => {
  const plan = withObjectives((o) => [
    { ...o[0], sources: [{ url: "https://docs.nebius.com/new-page.md" }] },
    ...o.slice(1),
  ]);
  let r = lint({ coverage: [plan] });
  assert.equal(r.ok, false);
  assert.match(r.output, /new-page\.md is neither captured nor in content\/capture-manifest\.yaml/);
  r = lint({
    coverage: [plan],
    manifest: {
      sources: [
        {
          id: "src-new-page",
          url: "https://docs.nebius.com/new-page.md",
          title: "New",
          coverage: [{ course_id: "agentic-ai-builder", objective: "domain-1/alpha" }],
        },
      ],
    },
  });
  assert.equal(r.ok, true, r.output);
});

test("rejects manifest coverage naming an objective the course does not define", () => {
  const { ok, output } = lint({
    manifest: {
      sources: [
        {
          id: "src-new-page",
          url: "https://docs.nebius.com/new-page.md",
          title: "New",
          coverage: [{ course_id: "agentic-ai-builder", objective: "domain-2/alpha" }],
        },
      ],
    },
  });
  assert.equal(ok, false);
  assert.match(output, /coverage objective domain-2\/alpha is not in course agentic-ai-builder/);
});

test("rejects a planned capture of a page already captured under another id", () => {
  const { ok, output } = lint({
    manifest: {
      sources: [
        {
          id: "src-again",
          url: "https://docs.nebius.com/agents",
          title: "Again",
          objectives: ["domain-1/alpha"],
        },
      ],
    },
  });
  assert.equal(ok, false);
  assert.match(output, /already captured as src-docs-agents/);
});

test("rejects an unparseable capture manifest", () => {
  const { ok, output } = lint({ manifest: "sources: [\n" });
  assert.equal(ok, false);
  assert.match(output, /capture-manifest\.yaml: unparseable YAML/);
});

// The course summary reaches the client catalog (the course card), so it is
// held to LEGAL.md's naming rule. Vendor names come from the course's own
// prepares_for and disclaimer, never from a list kept in the lint.
const VENDOR_COURSE = {
  ...COURSE_DEF,
  prepares_for: "Acme Test",
  disclaimer: { short: "Not affiliated with, endorsed by, or sponsored by Acme or Widgetco." },
};

test("accepts a vendor-neutral course summary", () => {
  const { ok, output } = lint({
    courseDef: { ...VENDOR_COURSE, summary: "Practise building and running agents." },
  });
  assert.equal(ok, true, output);
});

test("rejects a course summary that names the vendor from prepares_for", () => {
  const { ok, output } = lint({
    courseDef: { ...VENDOR_COURSE, summary: "Practise for the acme exam, step by step." },
  });
  assert.equal(ok, false);
  assert.match(output, /summary names "Acme"/);
});

test("rejects a course summary that names a party the disclaimer disowns", () => {
  const { ok, output } = lint({
    courseDef: { ...VENDOR_COURSE, summary: "Connect agents to the Widgetco API." },
  });
  assert.equal(ok, false);
  assert.match(output, /summary names "Widgetco"/);
});

test("rejects a course summary longer than one card sentence", () => {
  const { ok, output } = lint({ courseDef: { ...COURSE_DEF, summary: "word ".repeat(60) } });
  assert.equal(ok, false);
  assert.match(output, /summary/);
});

test("a vendor name in prepares_for still matches with a mark or possessive attached", () => {
  for (const prepares_for of ["Acme® Test", "Acme's Test"]) {
    const { ok, output } = lint({
      courseDef: { ...COURSE_DEF, prepares_for, summary: "Practise for the Acme exam, step by step." },
    });
    assert.equal(ok, false, prepares_for);
    assert.match(output, /summary names "Acme"/);
  }
});

test("rejects a manifest row whose coverage names an objective outside its own objectives", () => {
  const row = (objectives) => ({
    id: "src-new-page",
    url: "https://docs.nebius.com/new-page.md",
    title: "New",
    objectives,
    coverage: [{ course_id: "agentic-ai-builder", objective: "domain-1/alpha" }],
  });
  let r = lint({ manifest: { sources: [row(["domain-2/beta"])] } });
  assert.equal(r.ok, false);
  assert.match(r.output, /coverage objective domain-1\/alpha is not in the row's objectives/);
  r = lint({ manifest: { sources: [row(["domain-1/alpha", "domain-2/beta"])] } });
  assert.equal(r.ok, true, r.output);
});

test("a question citing a record covered for its course through `coverage` passes", () => {
  // The record's bare objectives belong to another course; only its
  // course-aware coverage maps it to this course's objective.
  const { ok, output } = lint({
    sources: [
      source({
        objectives: ["domain-2/beta"],
        coverage: [{ course_id: "agentic-ai-builder", objective: "domain-1/alpha" }],
      }),
    ],
  });
  assert.equal(ok, true, output);
});
