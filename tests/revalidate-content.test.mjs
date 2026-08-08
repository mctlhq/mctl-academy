import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { revalidateContent } from "../scripts/revalidate-content.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const mockStore = (map) => ({
  get: async (key) => map[key] ?? null,
});

test("revalidateContent repins source_sha256 and restores status to published when excerpt matches BBB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-revalidate-pass-"));
  try {
    mkdirSync(join(dir, "sources"), { recursive: true });
    mkdirSync(join(dir, "questions"), { recursive: true });

    const sourceRecord = {
      schema_version: 1,
      id: "src-revalidate-test",
      url: "https://docs.nebius.com/revalidate",
      title: "Revalidate Test",
      retrieved_at: "2026-08-06T10:00:00Z",
      sha256: HASH_B, // Upstream updated to HASH_B
      objectives: ["domain-1/alpha"],
      snapshot: { bucket: "academy-source-snapshots", key: HASH_B },
    };

    const questionRecord = {
      schema_version: 1,
      id: "q-revalidate001",
      course_id: "agentic-ai-builder",
      status: "needs_review", // Drifted, under review
      domain: "domain-1",
      objective: "domain-1/alpha",
      stem: "Which feature is enabled?",
      options: [
        { id: "a", text: "Streaming", correct: true, explanation: "Valid explanation" },
        { id: "b", text: "Option B", correct: false, explanation: "Valid explanation" },
        { id: "c", text: "Option C", correct: false, explanation: "Valid explanation" },
        { id: "d", text: "Option D", correct: false, explanation: "Valid explanation" },
      ],
      evidence: [
        {
          source_id: "src-revalidate-test",
          source_sha256: HASH_A, // Old hash A
          excerpt: "streaming response is supported by default",
        },
      ],
      authored: { by: "agent:writer", at: "2026-08-06T10:00:00Z" },
    };

    writeFileSync(join(dir, "sources", "src-revalidate-test.yaml"), JSON.stringify(sourceRecord));
    writeFileSync(join(dir, "questions", "q-revalidate001.yaml"), JSON.stringify(questionRecord));

    const store = mockStore({
      [HASH_B]: "updated page content where streaming response is supported by default remains intact",
    });

    const result = await revalidateContent({ contentDir: dir, store });

    assert.equal(result.totalProcessed, 1);
    assert.deepEqual(result.revalidated, ["q-revalidate001"]);
    assert.equal(result.unmatched.length, 0);

    const updated = parseYaml(readFileSync(join(dir, "questions", "q-revalidate001.yaml"), "utf8"));
    assert.equal(updated.status, "published");
    assert.equal(updated.evidence[0].source_sha256, HASH_B);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("revalidateContent transitions status to review_ready when excerpt is missing in BBB", async () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-revalidate-fail-"));
  try {
    mkdirSync(join(dir, "sources"), { recursive: true });
    mkdirSync(join(dir, "questions"), { recursive: true });

    const sourceRecord = {
      schema_version: 1,
      id: "src-revalidate-test",
      url: "https://docs.nebius.com/revalidate",
      title: "Revalidate Test",
      retrieved_at: "2026-08-06T10:00:00Z",
      sha256: HASH_B,
      objectives: ["domain-1/alpha"],
      snapshot: { bucket: "academy-source-snapshots", key: HASH_B },
    };

    const questionRecord = {
      schema_version: 1,
      id: "q-revalidate002",
      course_id: "agentic-ai-builder",
      status: "needs_review",
      domain: "domain-1",
      objective: "domain-1/alpha",
      stem: "Which feature is enabled?",
      options: [
        { id: "a", text: "Legacy feature", correct: true, explanation: "Valid explanation" },
        { id: "b", text: "Option B", correct: false, explanation: "Valid explanation" },
        { id: "c", text: "Option C", correct: false, explanation: "Valid explanation" },
        { id: "d", text: "Option D", correct: false, explanation: "Valid explanation" },
      ],
      evidence: [
        {
          source_id: "src-revalidate-test",
          source_sha256: HASH_A,
          excerpt: "legacy feature v1 is deprecated",
        },
      ],
      authored: { by: "agent:writer", at: "2026-08-06T10:00:00Z" },
    };

    writeFileSync(join(dir, "sources", "src-revalidate-test.yaml"), JSON.stringify(sourceRecord));
    writeFileSync(join(dir, "questions", "q-revalidate002.yaml"), JSON.stringify(questionRecord));

    const store = mockStore({
      [HASH_B]: "completely rewritten page where legacy feature was removed completely",
    });

    const result = await revalidateContent({ contentDir: dir, store, retireUnmatched: false });

    assert.equal(result.totalProcessed, 1);
    assert.equal(result.revalidated.length, 0);
    assert.deepEqual(result.unmatched, ["q-revalidate002"]);

    const updated = parseYaml(readFileSync(join(dir, "questions", "q-revalidate002.yaml"), "utf8"));
    assert.equal(updated.status, "review_ready");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
