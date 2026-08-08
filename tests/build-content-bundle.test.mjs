/**
 * The Practice mode client only ever ships published content — draft and
 * needs_review questions are unreviewed or drifted, and retired questions
 * are permanently withdrawn. This proves the bundle step enforces that
 * filter rather than trusting the client to apply it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const question = (id, status, over = {}) => ({
  id,
  status,
  domain: "domain-1",
  objective: "domain-1/api-authentication",
  stem: `Stem for ${id}`,
  options: [
    { id: "a", text: "An API key", correct: true, explanation: "Keys are issued per project." },
    { id: "b", text: "Two", correct: false, explanation: "No, that is not it." },
    { id: "c", text: "Three", correct: false, explanation: "No, that is not it." },
    { id: "d", text: "Four", correct: false, explanation: "No, that is not it." },
  ],
  evidence: [{ source_id: "src-x", excerpt: "authenticate using an API key" }],
  authored: { by: "agent:claude", at: "2026-08-06T00:00:00Z" },
  ...over,
});

function build(questions) {
  const dir = mkdtempSync(join(tmpdir(), "academy-bundle-"));
  const out = join(dir, "out", "content-bundle.json");
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    copyFileSync(join(ROOT, "content", "branding.yaml"), join(dir, "branding.yaml"));
    for (const q of questions) {
      writeFileSync(join(dir, "questions", `${q.id}.yaml`), JSON.stringify(q));
    }
    execFileSync("node", [join(ROOT, "scripts", "build-content-bundle.mjs")], {
      env: { ...process.env, ACADEMY_CONTENT_DIR: dir, ACADEMY_BUNDLE_OUT: out },
      stdio: "ignore",
    });
    return JSON.parse(readFileSync(out, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("keeps only status: published questions", () => {
  const bundle = build([
    question("q-published0001", "published"),
    question("q-draft00000001", "draft"),
    question("q-needsreview001", "needs_review"),
    question("q-retired0000001", "retired"),
  ]);

  assert.equal(bundle.length, 1);
  assert.equal(bundle[0].id, "q-published0001");
});

test("emits only the fields the client needs, per option", () => {
  const bundle = build([question("q-published0002", "published")]);
  const [q] = bundle;

  assert.deepEqual(Object.keys(q).sort(), ["course_id", "domain", "id", "objective", "options", "stem"].sort());
  assert.deepEqual(
    Object.keys(q.options[0]).sort(),
    ["correct", "explanation", "id", "text"].sort(),
  );
});

test("empty published set produces an empty array, not a missing file", () => {
  const bundle = build([question("q-draft00000002", "draft")]);
  assert.deepEqual(bundle, []);
});
