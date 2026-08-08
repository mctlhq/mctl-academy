import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { revalidateContent } from "../scripts/revalidate-content.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const sampleSource = (over = {}) => ({
  schema_version: 1,
  id: "src-auth",
  url: "https://docs.nebius.com/auth",
  host: "docs.nebius.com",
  title: "Authentication",
  retrieved_at: "2026-08-06T00:00:00Z",
  sha256: HASH_B,
  snapshot: {
    key: HASH_B,
    sha256: HASH_B,
    byte_length: 500,
    content_type: "text/markdown",
  },
  versions: [HASH_A, HASH_B],
  coverage: [{ course_id: "agentic-ai-builder", objective: "domain-1/api-authentication" }],
  status: "current",
  ...over,
});

const sampleQuestion = (over = {}) => ({
  schema_version: 1,
  id: "q-needsrev001",
  course_id: "agentic-ai-builder",
  status: "needs_review",
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
      source_sha256: HASH_A,
      excerpt: "requests must include Authorization Bearer header",
    },
  ],
  authored: { by: "agent:question-author", at: "2026-08-06T10:00:00Z" },
  ...over,
});

test("revalidateContent repins source_sha256 and transitions status to review_ready when excerpt matches BBB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-revalidate-"));
  try {
    mkdirSync(join(dir, "sources"), { recursive: true });
    mkdirSync(join(dir, "questions"), { recursive: true });

    writeFileSync(join(dir, "sources", "src-auth.yaml"), JSON.stringify(sampleSource()));
    const qPath = join(dir, "questions", "q-needsrev001.yaml");
    writeFileSync(qPath, JSON.stringify(sampleQuestion()));

    const store = {
      async get(key) {
        if (key === HASH_B) {
          return "Documentation: requests must include Authorization Bearer header for API calls.";
        }
        return null;
      },
    };

    const result = await revalidateContent({ contentDir: dir, store });

    assert.equal(result.totalProcessed, 1);
    assert.equal(result.revalidated.length, 1);
    assert.equal(result.revalidated[0], "q-needsrev001");

    const updated = parseYaml(readFileSync(qPath, "utf8"));
    assert.equal(updated.status, "review_ready");
    assert.equal(updated.evidence[0].source_sha256, HASH_B);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("revalidateContent atomic repinning: does NOT repin any hash if second evidence item mismatches", async () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-revalidate-"));
  try {
    mkdirSync(join(dir, "sources"), { recursive: true });
    mkdirSync(join(dir, "questions"), { recursive: true });

    writeFileSync(join(dir, "sources", "src-auth.yaml"), JSON.stringify(sampleSource()));
    const qPath = join(dir, "questions", "q-multi.yaml");
    writeFileSync(
      qPath,
      JSON.stringify(
        sampleQuestion({
          id: "q-multi",
          evidence: [
            { source_id: "src-auth", source_sha256: HASH_A, excerpt: "requests must include Authorization Bearer header" },
            { source_id: "src-auth", source_sha256: HASH_A, excerpt: "NONEXISTENT EXCERPT IN BBB" },
          ],
        }),
      ),
    );

    const store = {
      async get(key) {
        if (key === HASH_B) {
          return "Documentation: requests must include Authorization Bearer header for API calls.";
        }
        return null;
      },
    };

    const result = await revalidateContent({ contentDir: dir, store });

    assert.equal(result.unmatched.length, 1);

    const updated = parseYaml(readFileSync(qPath, "utf8"));
    assert.equal(updated.status, "review_ready");
    // Verify first evidence item was NOT partially repinned (remains HASH_A)
    assert.equal(updated.evidence[0].source_sha256, HASH_A);
    assert.equal(updated.evidence[1].source_sha256, HASH_A);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("revalidateContent fault-tolerant R2 errors: records error and keeps question in review_ready without crashing batch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-revalidate-"));
  try {
    mkdirSync(join(dir, "sources"), { recursive: true });
    mkdirSync(join(dir, "questions"), { recursive: true });

    writeFileSync(join(dir, "sources", "src-auth.yaml"), JSON.stringify(sampleSource()));
    const qPath = join(dir, "questions", "q-err.yaml");
    writeFileSync(qPath, JSON.stringify(sampleQuestion({ id: "q-err" })));

    const store = {
      async get() {
        throw new Error("R2 Connection Timeout");
      },
    };

    const result = await revalidateContent({ contentDir: dir, store });

    assert.equal(result.totalProcessed, 1);
    assert.equal(result.unmatched.length, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /R2 Connection Timeout/);

    const updated = parseYaml(readFileSync(qPath, "utf8"));
    assert.equal(updated.status, "review_ready");
    assert.equal(updated.evidence[0].source_sha256, HASH_A);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
