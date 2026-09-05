/**
 * The build-time evidence gate.
 *
 * The client bundle is the only thing a learner ever sees, and nothing in the
 * application re-checks evidence at runtime — so "unsafe content cannot reach
 * a learner" is exactly the claim "unsafe content cannot reach this file".
 * Each case below is one way content can be unsafe.
 *
 * The same file also generates the client course catalog, so its shape and its
 * availability flags are asserted here rather than trusted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const HASH = "a".repeat(64);

const course = (over = {}) => ({
  schema_version: 1,
  id: "agentic-ai-builder",
  prepares_for: "Some Vendor Certification",
  title: "Agentic AI Builder",
  description: "Course description mentioning Some Vendor.",
  mock: { question_count: 30, time_limit_minutes: 60, disclose_bank_size: true },
  domains: [
    {
      id: "domain-1",
      title: "One",
      weight: 100,
      mock_questions: 30,
      objectives: [{ id: "alpha", title: "Alpha" }],
    },
  ],
  ...over,
});

const source = (over = {}) => ({
  schema_version: 1,
  id: "src-x",
  url: "https://docs.nebius.com/x",
  title: "X",
  retrieved_at: "2026-08-06T10:00:00Z",
  sha256: HASH,
  status: "current",
  snapshot: { bucket: "academy-source-snapshots", key: HASH },
  ...over,
});

const question = (id, status, over = {}) => ({
  id,
  course_id: "agentic-ai-builder",
  status,
  domain: "domain-1",
  objective: "domain-1/alpha",
  stem: `Stem for ${id}`,
  options: [
    { id: "a", text: "An API key", correct: true, explanation: "Keys are issued per project." },
    { id: "b", text: "Two", correct: false, explanation: "No, that is not it." },
    { id: "c", text: "Three", correct: false, explanation: "No, that is not it." },
    { id: "d", text: "Four", correct: false, explanation: "No, that is not it." },
  ],
  evidence: [{ source_id: "src-x", excerpt: "authenticate using an API key" }],
  authored: { by: "agent:claude", at: "2026-08-06T00:00:00Z" },
  reviewed: { by: "mashkovd", at: "2026-08-06T11:00:00Z" },
  ...over,
});

function build({ questions = [], sources = [source()], courses = [course()] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "academy-bundle-"));
  const out = join(dir, "out", "content-bundle.json");
  const catalogOut = join(dir, "out", "course-catalog.json");
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    mkdirSync(join(dir, "sources"), { recursive: true });
    mkdirSync(join(dir, "courses"), { recursive: true });
    for (const c of courses) writeFileSync(join(dir, "courses", `${c.id}.yaml`), JSON.stringify(c));
    for (const s of sources) writeFileSync(join(dir, "sources", `${s.id}.yaml`), JSON.stringify(s));
    for (const q of questions) writeFileSync(join(dir, "questions", `${q.id}.yaml`), JSON.stringify(q));

    execFileSync("node", [join(ROOT, "scripts", "build-content-bundle.mjs")], {
      env: {
        ...process.env,
        ACADEMY_CONTENT_DIR: dir,
        ACADEMY_BUNDLE_OUT: out,
        ACADEMY_CATALOG_OUT: catalogOut,
      },
      stdio: "ignore",
    });
    return {
      bundle: JSON.parse(readFileSync(out, "utf8")),
      catalog: JSON.parse(readFileSync(catalogOut, "utf8")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const ids = (bundle) => bundle.map((q) => q.id);

// -------------------------------------------------------------- eligibility

test("emits a published question whose evidence is intact", () => {
  const { bundle } = build({ questions: [question("q-published0001", "published")] });
  assert.deepEqual(ids(bundle), ["q-published0001"]);
});

test("withholds every non-published status, needs_review included", () => {
  const { bundle } = build({
    questions: [
      question("q-published0001", "published"),
      question("q-draft00000001", "draft"),
      question("q-needsreview001", "needs_review"),
      question("q-retired0000001", "retired"),
      question("q-reviewready001", "review_ready"),
    ],
  });
  assert.deepEqual(ids(bundle), ["q-published0001"]);
});

test("withholds a published question citing a drifted source", () => {
  const { bundle } = build({
    questions: [question("q-drifted0000001", "published")],
    sources: [source({ status: "drifted" })],
  });
  assert.deepEqual(bundle, []);
});

test("withholds a published question citing a deprecated source", () => {
  const { bundle } = build({
    questions: [question("q-deprecated001", "published")],
    sources: [source({ status: "deprecated" })],
  });
  assert.deepEqual(bundle, []);
});

test("withholds a published question citing a source that does not exist", () => {
  const { bundle } = build({
    questions: [question("q-unknownsrc001", "published")],
    sources: [],
  });
  assert.deepEqual(bundle, []);
});

test("withholds a published question whose source was never snapshotted", () => {
  const { bundle } = build({
    questions: [question("q-nosnapshot001", "published")],
    sources: [source({ snapshot: undefined })],
  });
  assert.deepEqual(bundle, []);
});

test("withholds a published question with no human review recorded", () => {
  const { bundle } = build({
    questions: [question("q-unreviewed001", "published", { reviewed: undefined })],
  });
  assert.deepEqual(bundle, []);
});

test("one unsafe question does not withhold its safe neighbours", () => {
  const { bundle } = build({
    questions: [
      question("q-safe00000001", "published"),
      question("q-needsreview001", "needs_review"),
      question("q-safe00000002", "published"),
    ],
  });
  assert.deepEqual(ids(bundle).sort(), ["q-safe00000001", "q-safe00000002"]);
});

// ------------------------------------------------------------------- shape

test("emits only the fields the client needs, per question and per option", () => {
  const { bundle } = build({ questions: [question("q-published0002", "published")] });
  const [q] = bundle;

  assert.deepEqual(
    Object.keys(q).sort(),
    ["course_id", "domain", "id", "objective", "objectiveTitle", "sources", "options", "stem"].sort(),
  );
  assert.deepEqual(Object.keys(q.options[0]).sort(), ["correct", "explanation", "id", "text"].sort());
  assert.equal(q.objectiveTitle, "Alpha");
  assert.deepEqual(q.sources, [
    { title: "X", url: "https://docs.nebius.com/x", excerpt: "authenticate using an API key" },
  ]);
});

test("empty eligible set produces an empty array, not a missing file", () => {
  const { bundle } = build({ questions: [question("q-draft00000002", "draft")] });
  assert.deepEqual(bundle, []);
});

// ----------------------------------------------------------------- catalog

test("catalog discovers every canonical course definition", () => {
  const { catalog } = build({
    courses: [course(), course({ id: "ai-leader", title: "AI Leader" })],
  });
  assert.deepEqual(
    catalog.map((c) => c.id),
    ["agentic-ai-builder", "ai-leader"],
  );
});

test("catalog title and mock config come from canonical course metadata", () => {
  const { catalog } = build({
    courses: [
      course({
        title: "Renamed Course",
        mock: { question_count: 12, time_limit_minutes: 25, disclose_bank_size: false },
        // Moved off the helper's default 30 deliberately: the per-domain
        // mock_questions must sum to question_count, which
        // scripts/lib/validate-generated-artifacts.mjs now enforces at the
        // build boundary. Overriding only question_count would describe an
        // exam the mock builder cannot actually compose.
        domains: [
          {
            id: "domain-1",
            title: "One",
            weight: 100,
            mock_questions: 12,
            objectives: [{ id: "alpha", title: "Alpha" }],
          },
        ],
      }),
    ],
  });
  assert.equal(catalog[0].title, "Renamed Course");
  assert.equal(catalog[0].mock.questionCount, 12);
  assert.equal(catalog[0].mock.timeLimitMinutes, 25);
  assert.equal(catalog[0].mock.discloseBankSize, false);
  assert.deepEqual(catalog[0].mock.domains, [
    { id: "domain-1", title: "One", weight: 100, mockQuestions: 12 },
  ]);
});

test("publishedQuestionCount counts only questions that reached the bundle", () => {
  const { catalog } = build({
    questions: [
      question("q-published0001", "published"),
      question("q-published0002", "published"),
      question("q-needsreview001", "needs_review"),
    ],
  });
  assert.equal(catalog[0].publishedQuestionCount, 2);
  assert.equal(catalog[0].available, true);
});

test("a course with no published questions is listed but unavailable", () => {
  const { catalog } = build({
    courses: [course(), course({ id: "ai-leader", title: "AI Leader" })],
    questions: [question("q-published0001", "published")],
  });
  const leader = catalog.find((c) => c.id === "ai-leader");
  assert.equal(leader.publishedQuestionCount, 0);
  assert.equal(leader.available, false);
});

test("no vendor certification naming leaks into the client catalog", () => {
  const { catalog } = build({
    courses: [course({ prepares_for: "Vendor Certified Widget Engineer" })],
  });
  const serialized = JSON.stringify(catalog);
  assert.ok(!serialized.includes("Vendor Certified Widget Engineer"), "prepares_for must stay in content/");
  assert.ok(!serialized.includes("prepares_for"));
  assert.ok(!serialized.includes("description"));
  assert.ok(!serialized.includes("disclaimer"));
});
