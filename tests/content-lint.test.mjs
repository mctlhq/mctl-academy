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

/** Runs the lint against a fixture tree. Returns { ok, output }. */
function lint({ sources = [source()], questions = [question()], receipts = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "academy-lint-"));
  try {
    mkdirSync(join(dir, "courses"), { recursive: true });
    mkdirSync(join(dir, "sources"), { recursive: true });
    mkdirSync(join(dir, "questions"), { recursive: true });
    mkdirSync(join(dir, "reviews"), { recursive: true });
    receipts.forEach((r, i) => writeFileSync(join(dir, "reviews", `r${i}-review.json`), JSON.stringify(r)));
    writeFileSync(join(dir, "courses", "agentic-ai-builder.yaml"), JSON.stringify(COURSE_DEF));
    sources.forEach((s, i) => writeFileSync(join(dir, "sources", `s${i}.yaml`), JSON.stringify(s)));
    questions.forEach((q, i) => writeFileSync(join(dir, "questions", `q${i}.yaml`), JSON.stringify(q)));

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
