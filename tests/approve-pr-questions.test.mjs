import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { promoteQuestions } from "../scripts/approve-pr-questions.mjs";

const HASH = "a".repeat(64);

const sampleQuestion = (over = {}) => ({
  schema_version: 1,
  id: "q-review000001",
  course_id: "agentic-ai-builder",
  status: "review_ready",
  domain: "domain-1",
  objective: "domain-1/api-authentication",
  stem: "Which header passes the API key in requests?",
  options: [
    { id: "a", text: "Authorization: Bearer <key>", correct: true, explanation: "Valid header format." },
    { id: "b", text: "X-Key: <key>", correct: false, explanation: "Incorrect header name." },
    { id: "c", text: "Cookie: key=<key>", correct: false, explanation: "Incorrect header type." },
    { id: "d", text: "User-Agent: key", correct: false, explanation: "Incorrect header." },
  ],
  evidence: [
    {
      source_id: "src-auth",
      source_sha256: HASH,
      excerpt: "requests must include Authorization Bearer header",
    },
  ],
  authored: { by: "agent:question-author", at: "2026-08-06T10:00:00Z" },
  ...over,
});

test("promotes review_ready question to published and stamps maintainer review", () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-approve-"));
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    const filePath = join(dir, "questions", "q-review000001.yaml");
    writeFileSync(filePath, JSON.stringify(sampleQuestion()));

    const result = promoteQuestions({
      contentDir: dir,
      by: "mashkovd",
      idsOrPaths: [filePath],
    });

    assert.equal(result.count, 1);
    assert.deepEqual(result.promoted, ["q-review000001"]);

    const updated = parseYaml(readFileSync(filePath, "utf8"));
    assert.equal(updated.status, "published");
    assert.equal(updated.reviewed.by, "mashkovd");
    assert.ok(updated.reviewed.at);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects promotion if maintainer handle is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-approve-"));
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    const filePath = join(dir, "questions", "q-review000001.yaml");
    writeFileSync(filePath, JSON.stringify(sampleQuestion()));

    assert.throws(
      () => promoteQuestions({ contentDir: dir, by: null, idsOrPaths: [filePath] }),
      /Maintainer handle required/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects promotion if question is authored by a human rather than an agent", () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-approve-"));
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    const filePath = join(dir, "questions", "q-review000001.yaml");
    writeFileSync(filePath, JSON.stringify(sampleQuestion({ authored: { by: "mashkovd", at: "2026-08-06T10:00:00Z" } })));

    assert.throws(
      () => promoteQuestions({ contentDir: dir, by: "mashkovd", idsOrPaths: [filePath] }),
      /agent author/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects promotion if question status is already published or retired", () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-approve-"));
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    const filePath = join(dir, "questions", "q-review000001.yaml");
    writeFileSync(filePath, JSON.stringify(sampleQuestion({ status: "published" })));

    assert.throws(
      () => promoteQuestions({ contentDir: dir, by: "mashkovd", idsOrPaths: [filePath] }),
      /Only items in "review_ready" or "draft" can be promoted/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("promotes all review_ready questions when allReviewReady is specified", () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-approve-"));
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    writeFileSync(join(dir, "questions", "q1.yaml"), JSON.stringify(sampleQuestion({ id: "q-review000001" })));
    writeFileSync(join(dir, "questions", "q2.yaml"), JSON.stringify(sampleQuestion({ id: "q-review000002" })));
    writeFileSync(join(dir, "questions", "q3.yaml"), JSON.stringify(sampleQuestion({ id: "q-review000003", status: "published" })));

    const result = promoteQuestions({
      contentDir: dir,
      by: "mashkovd",
      allReviewReady: true,
    });

    assert.equal(result.count, 2);
    assert.deepEqual(result.promoted.sort(), ["q-review000001", "q-review000002"].sort());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
