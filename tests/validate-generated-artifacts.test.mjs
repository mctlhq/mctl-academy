/**
 * The generated artefacts' output contract.
 *
 * These cases are deliberately NOT a second copy of the source-schema tests in
 * content-lint.test.mjs / build-content-bundle.test.mjs, which prove that bad
 * *content* is rejected. Every fixture here is an already-built artefact pair,
 * so what is under test is the builder's own output staying internally
 * consistent — the failure mode where content is perfectly fine but the
 * projection that emitted it is not.
 *
 * The last case runs the real builder and asserts the real artefacts pass,
 * which is what keeps this contract honest rather than a description of a
 * shape nothing actually produces.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGeneratedArtifacts } from "../scripts/lib/validate-generated-artifacts.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const option = (id, correct = false) => ({
  id,
  text: `Option ${id}`,
  correct,
  explanation: `Why ${id}`,
});

const question = (over = {}) => ({
  id: "q-000000000001",
  course_id: "course-a",
  domain: "domain-1",
  objective: "domain-1/alpha",
  stem: "A stem",
  options: [option("a", true), option("b"), option("c"), option("d")],
  ...over,
});

const domain = (over = {}) => ({ id: "domain-1", title: "One", weight: 100, mockQuestions: 30, ...over });

const course = (over = {}) => ({
  id: "course-a",
  title: "Course A",
  publishedQuestionCount: 1,
  available: true,
  mock: {
    questionCount: 30,
    timeLimitMinutes: 60,
    discloseBankSize: true,
    domains: [domain()],
    ...(over.mock ?? {}),
  },
  ...over,
});

/** A minimal, internally consistent artefact pair — the baseline every case mutates. */
const valid = () => ({ bundle: [question()], catalog: [course()] });

function assertRejects(bundle, catalog, expectedFragment) {
  const errors = validateGeneratedArtifacts(bundle, catalog);
  assert.ok(errors.length > 0, "expected at least one contract error, got none");
  assert.ok(
    errors.some((e) => e.includes(expectedFragment)),
    `expected an error mentioning ${JSON.stringify(expectedFragment)}, got:\n${errors.join("\n")}`,
  );
}

describe("validateGeneratedArtifacts — a well-formed pair", () => {
  test("accepts a minimal consistent bundle and catalog", () => {
    const { bundle, catalog } = valid();
    assert.deepEqual(validateGeneratedArtifacts(bundle, catalog), []);
  });

  test("accepts a course with no published questions, marked unavailable", () => {
    const bundle = [];
    const catalog = [course({ publishedQuestionCount: 0, available: false })];
    assert.deepEqual(validateGeneratedArtifacts(bundle, catalog), []);
  });
});

describe("validateGeneratedArtifacts — malformed bundle", () => {
  test("rejects a bundle that is not an array", () => {
    assertRejects({ questions: [] }, valid().catalog, "bundle: expected an array");
  });

  test("rejects a question missing a required field", () => {
    const { catalog } = valid();
    assertRejects([question({ stem: "" })], catalog, "bundle[0].stem");
  });

  test("rejects an option id outside a/b/c/d — the union the client type asserts", () => {
    const { catalog } = valid();
    const broken = question({ options: [option("e", true), option("b"), option("c"), option("d")] });
    assertRejects([broken], catalog, "expected one of a/b/c/d");
  });

  test("rejects a question with no correct option", () => {
    const { catalog } = valid();
    const broken = question({ options: [option("a"), option("b"), option("c"), option("d")] });
    assertRejects([broken], catalog, "expected exactly one correct option, got 0");
  });

  test("rejects a question with more than one correct option", () => {
    const { catalog } = valid();
    const broken = question({ options: [option("a", true), option("b", true), option("c"), option("d")] });
    assertRejects([broken], catalog, "expected exactly one correct option, got 2");
  });

  test("rejects a duplicate question id, which would merge two questions' attempt history", () => {
    const catalog = [course({ publishedQuestionCount: 2 })];
    assertRejects([question(), question()], catalog, "duplicate question id");
  });
});

describe("validateGeneratedArtifacts — malformed catalog", () => {
  test("rejects duplicate course ids", () => {
    const bundle = [question()];
    const catalog = [course(), course({ publishedQuestionCount: 1 })];
    assertRejects(bundle, catalog, "duplicate course id");
  });

  test("rejects duplicate domain ids within one course", () => {
    const { bundle } = valid();
    const catalog = [
      course({ mock: { questionCount: 30, timeLimitMinutes: 60, discloseBankSize: true, domains: [domain({ mockQuestions: 15 }), domain({ mockQuestions: 15 })] } }),
    ];
    assertRejects(bundle, catalog, "duplicate domain id");
  });

  test("rejects domain mockQuestions that do not sum to questionCount", () => {
    const { bundle } = valid();
    const catalog = [course({ mock: { questionCount: 30, timeLimitMinutes: 60, discloseBankSize: true, domains: [domain({ mockQuestions: 29 })] } })];
    assertRejects(bundle, catalog, "sum to 29, but questionCount is 30");
  });
});

describe("validateGeneratedArtifacts — cross-artefact coherence", () => {
  test("rejects publishedQuestionCount disagreeing with the bundle's actual count", () => {
    const { bundle } = valid();
    assertRejects(bundle, [course({ publishedQuestionCount: 7 })], "but the bundle carries 1 question(s)");
  });

  test("rejects available=true on a course with no published questions", () => {
    assertRejects([], [course({ publishedQuestionCount: 0, available: true })], "expected false for publishedQuestionCount 0");
  });

  test("rejects available=false on a course that does have published questions", () => {
    const { bundle } = valid();
    assertRejects(bundle, [course({ available: false })], "expected true for publishedQuestionCount 1");
  });

  test("rejects a question whose course_id is not in the catalog", () => {
    const bundle = [question({ course_id: "course-ghost" })];
    const catalog = [course({ publishedQuestionCount: 0, available: false })];
    assertRejects(bundle, catalog, "is not in the catalog");
  });

  test("rejects a question whose domain its course does not declare", () => {
    const bundle = [question({ domain: "domain-9" })];
    assertRejects(bundle, valid().catalog, "is not a domain of course");
  });
});

describe("validateGeneratedArtifacts — the real build output", () => {
  test("the artefacts a normal build produces satisfy the contract", () => {
    execFileSync(process.execPath, [join(ROOT, "scripts", "build-content-bundle.mjs")], {
      cwd: ROOT,
      stdio: "pipe",
    });

    const bundle = JSON.parse(readFileSync(join(ROOT, "client", "src", "content-bundle.json"), "utf8"));
    const catalog = JSON.parse(readFileSync(join(ROOT, "client", "src", "course-catalog.json"), "utf8"));

    assert.deepEqual(validateGeneratedArtifacts(bundle, catalog), []);
    assert.ok(bundle.length > 0, "a real build should emit at least one question");
    assert.ok(catalog.length > 0, "a real build should emit at least one course");
  });

  test("a course whose domain counts do not sum fails the build, and writes neither file", () => {
    // Chosen because the source-side lint accepts this content: question_count
    // and the per-domain mock_questions are separately valid, and nothing
    // before this contract compared them. It is exactly the class of bug this
    // check exists for — valid inputs, incoherent output.
    const dir = mkdtempSync(join(tmpdir(), "academy-contract-"));
    mkdirSync(join(dir, "courses"), { recursive: true });
    for (const sub of ["questions", "sources", "lessons"]) mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(
      join(dir, "courses", "course-a.yaml"),
      [
        "schema_version: 1",
        "id: course-a",
        "prepares_for: Some Vendor Certification",
        "title: Course A",
        "description: Desc",
        "mock:",
        "  question_count: 30",
        "  time_limit_minutes: 60",
        "  disclose_bank_size: true",
        "domains:",
        "  - id: domain-1",
        "    title: One",
        "    weight: 100",
        "    mock_questions: 29", // one short of question_count
        "    objectives:",
        "      - id: alpha",
        "        title: Alpha",
        "",
      ].join("\n"),
    );

    const bundleOut = join(dir, "bundle.json");
    const catalogOut = join(dir, "catalog.json");

    let failed = false;
    let stderr = "";
    try {
      execFileSync(process.execPath, [join(ROOT, "scripts", "build-content-bundle.mjs")], {
        cwd: ROOT,
        stdio: "pipe",
        env: {
          ...process.env,
          ACADEMY_CONTENT_DIR: dir,
          ACADEMY_BUNDLE_OUT: bundleOut,
          ACADEMY_CATALOG_OUT: catalogOut,
        },
      });
    } catch (err) {
      failed = true;
      stderr = String(err.stderr ?? "");
    }

    assert.ok(failed, "the build should exit non-zero on a contract violation");
    assert.match(stderr, /failed their output contract/);
    assert.match(stderr, /domain mockQuestions sum to 29, but questionCount is 30/);

    // The point of validating before writing: a rejected artefact must not be
    // left on disk for the next build/test run to pick up.
    assert.equal(existsSync(bundleOut), false, "no bundle should be written when the contract fails");
    assert.equal(existsSync(catalogOut), false, "no catalog should be written when the contract fails");

    rmSync(dir, { recursive: true, force: true });
  });
});
