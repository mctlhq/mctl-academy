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

test("revalidation is explicit, dry-run preserves bytes, selected success clears prior approval", async () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-revalidate-scope-"));
  try {
    mkdirSync(join(dir, "sources"));
    mkdirSync(join(dir, "questions"));
    writeFileSync(join(dir, "sources", "src-auth.yaml"), JSON.stringify(sampleSource()));
    const q = sampleQuestion({ reviewed: { by: "old-reviewer", at: "2026-08-06T10:00:00Z" } });
    const path = join(dir, "questions", "one.yaml");
    const otherPath = join(dir, "questions", "other.yaml");
    const original = JSON.stringify(q);
    writeFileSync(path, original);
    const other = JSON.stringify(sampleQuestion({ id: "q-other" }));
    writeFileSync(otherPath, other);
    const store = {
      async get() {
        return q.evidence[0].excerpt;
      },
    };
    await assert.rejects(revalidateContent({ contentDir: dir, store }), /explicit/);
    await assert.rejects(revalidateContent({ contentDir: dir, store, ids: ["missing"] }), /expected/);
    const opts = { contentDir: dir, store, ids: [q.id] };
    assert.equal((await revalidateContent({ ...opts, dryRun: true })).revalidated.length, 1);
    assert.equal(readFileSync(path, "utf8"), original);
    await revalidateContent(opts);
    assert.equal(parseYaml(readFileSync(path, "utf8")).reviewed, undefined);
    assert.equal(readFileSync(otherPath, "utf8"), other);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

    const result = await revalidateContent({
      contentDir: dir,
      store,
      ids: [parseYaml(readFileSync(qPath, "utf8")).id],
    });

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
            {
              source_id: "src-auth",
              source_sha256: HASH_A,
              excerpt: "requests must include Authorization Bearer header",
            },
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

    const result = await revalidateContent({
      contentDir: dir,
      store,
      ids: [parseYaml(readFileSync(qPath, "utf8")).id],
    });

    assert.equal(result.unmatched.length, 1);

    const updated = parseYaml(readFileSync(qPath, "utf8"));
    assert.equal(updated.status, "needs_review");
    // Verify first evidence item was NOT partially repinned (remains HASH_A)
    assert.equal(updated.evidence[0].source_sha256, HASH_A);
    assert.equal(updated.evidence[1].source_sha256, HASH_A);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("revalidateContent fault-tolerant R2 errors: records error and keeps question in needs_review without crashing batch", async () => {
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

    const result = await revalidateContent({
      contentDir: dir,
      store,
      ids: [parseYaml(readFileSync(qPath, "utf8")).id],
    });

    assert.equal(result.totalProcessed, 1);
    assert.equal(result.unmatched.length, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /R2 Connection Timeout/);

    const updated = parseYaml(readFileSync(qPath, "utf8"));
    assert.equal(updated.status, "needs_review");
    assert.equal(updated.evidence[0].source_sha256, HASH_A);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("revalidateContent refuses to claim a repin it could not write into the YAML", async () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-revalidate-"));
  try {
    mkdirSync(join(dir, "sources"), { recursive: true });
    mkdirSync(join(dir, "questions"), { recursive: true });

    writeFileSync(join(dir, "sources", "src-auth.yaml"), JSON.stringify(sampleSource()));

    // `evidence` is an alias here. toJS() resolves it, so every excerpt check
    // upstream sees a perfectly ordinary array and matches -- but the node
    // under the `evidence` key is an Alias, which no repin can be written
    // into. This is the shape that used to be skipped silently while the
    // question was still reported as revalidated.
    const qPath = join(dir, "questions", "q-alias.yaml");
    writeFileSync(
      qPath,
      [
        "schema_version: 1",
        "id: q-alias",
        "course_id: agentic-ai-builder",
        "status: needs_review",
        "domain: domain-1",
        "objective: domain-1/api-authentication",
        "stem: Which header passes the API key in requests?",
        "options:",
        "  - { id: a, text: 'Authorization: Bearer <key>', correct: true, explanation: Valid. }",
        "  - { id: b, text: 'X-Key: <key>', correct: false, explanation: Wrong name. }",
        "_evidence: &ev",
        "  - source_id: src-auth",
        `    source_sha256: ${HASH_A}`,
        "    excerpt: requests must include Authorization Bearer header",
        "evidence: *ev",
        "authored: { by: 'agent:question-author', at: '2026-08-06T10:00:00Z' }",
        "",
      ].join("\n"),
    );

    const store = {
      async get(key) {
        if (key === HASH_B) {
          return "Documentation: requests must include Authorization Bearer header for API calls.";
        }
        return null;
      },
    };

    const result = await revalidateContent({
      contentDir: dir,
      store,
      ids: [parseYaml(readFileSync(qPath, "utf8")).id],
    });

    assert.deepEqual(result.revalidated, [], "a question whose hashes were never written is not revalidated");
    assert.deepEqual(result.unmatched, ["q-alias"]);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /cannot be repinned/);

    // The decisive assertion: the hash on disk is still the old one, which is
    // precisely why claiming revalidation would have been a lie.
    const updated = parseYaml(readFileSync(qPath, "utf8"));
    assert.equal(updated.evidence[0].source_sha256, HASH_A);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
