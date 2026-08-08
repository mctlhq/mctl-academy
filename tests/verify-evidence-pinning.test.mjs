import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyEvidence, requiresVerification } from "../scripts/verify-evidence.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const mockStore = (map) => ({
  get: async (key) => map[key] ?? null,
});

test("requiresVerification includes published, review_ready, and needs_review", () => {
  assert.equal(requiresVerification("published"), true);
  assert.equal(requiresVerification("review_ready"), true);
  assert.equal(requiresVerification("needs_review"), true);
  assert.equal(requiresVerification("draft"), false);
  assert.equal(requiresVerification("retired"), false);
});

test("evidence pinned to HASH_A verifies against HASH_A snapshot even when source sha256 is HASH_B", async () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-pinning-"));
  try {
    mkdirSync(join(dir, "sources"), { recursive: true });
    mkdirSync(join(dir, "questions"), { recursive: true });

    const sourceRecord = {
      schema_version: 1,
      id: "src-pinning-test",
      url: "https://docs.nebius.com/pinning",
      title: "Pinning Test",
      retrieved_at: "2026-08-06T10:00:00Z",
      sha256: HASH_B, // Upstream drifted to HASH_B
      objectives: ["domain-1/alpha"],
      snapshot: { bucket: "academy-source-snapshots", key: HASH_B },
    };

    const questionRecord = {
      schema_version: 1,
      id: "q-pinning00001",
      course_id: "agentic-ai-builder",
      status: "published",
      domain: "domain-1",
      objective: "domain-1/alpha",
      stem: "Question pinned to version A",
      options: [
        { id: "a", text: "Correct", correct: true, explanation: "Valid explanation" },
        { id: "b", text: "Wrong 1", correct: false, explanation: "Valid explanation" },
        { id: "c", text: "Wrong 2", correct: false, explanation: "Valid explanation" },
        { id: "d", text: "Wrong 3", correct: false, explanation: "Valid explanation" },
      ],
      evidence: [
        {
          source_id: "src-pinning-test",
          source_sha256: HASH_A, // Explicitly pinned to snapshot A
          excerpt: "original verbatim text from snapshot A",
        },
      ],
      authored: { by: "agent:writer", at: "2026-08-06T10:00:00Z" },
      reviewed: { by: "mashkovd", at: "2026-08-06T11:00:00Z" },
    };

    writeFileSync(join(dir, "sources", "src-pinning-test.yaml"), JSON.stringify(sourceRecord));
    writeFileSync(join(dir, "questions", "q-pinning00001.yaml"), JSON.stringify(questionRecord));

    const store = mockStore({
      [HASH_A]: "original verbatim text from snapshot A - legacy page contents",
      [HASH_B]: "completely new text from snapshot B where original text was removed",
    });

    const result = await verifyEvidence({ contentDir: dir, store });
    assert.equal(result.errors.length, 0, result.errors.join("; "));
    assert.equal(result.checked, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("evidence pinned to HASH_A fails when HASH_A snapshot is missing from R2", async () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-pinning-fail-"));
  try {
    mkdirSync(join(dir, "sources"), { recursive: true });
    mkdirSync(join(dir, "questions"), { recursive: true });

    const sourceRecord = {
      schema_version: 1,
      id: "src-pinning-test",
      url: "https://docs.nebius.com/pinning",
      title: "Pinning Test",
      retrieved_at: "2026-08-06T10:00:00Z",
      sha256: HASH_B,
      objectives: ["domain-1/alpha"],
      snapshot: { bucket: "academy-source-snapshots", key: HASH_B },
    };

    const questionRecord = {
      schema_version: 1,
      id: "q-pinning00002",
      course_id: "agentic-ai-builder",
      status: "published",
      domain: "domain-1",
      objective: "domain-1/alpha",
      stem: "Question pinned to version A",
      options: [
        { id: "a", text: "Correct", correct: true, explanation: "Valid explanation" },
        { id: "b", text: "Wrong 1", correct: false, explanation: "Valid explanation" },
        { id: "c", text: "Wrong 2", correct: false, explanation: "Valid explanation" },
        { id: "d", text: "Wrong 3", correct: false, explanation: "Valid explanation" },
      ],
      evidence: [
        {
          source_id: "src-pinning-test",
          source_sha256: HASH_A,
          excerpt: "original verbatim text from snapshot A",
        },
      ],
      authored: { by: "agent:writer", at: "2026-08-06T10:00:00Z" },
      reviewed: { by: "mashkovd", at: "2026-08-06T11:00:00Z" },
    };

    writeFileSync(join(dir, "sources", "src-pinning-test.yaml"), JSON.stringify(sourceRecord));
    writeFileSync(join(dir, "questions", "q-pinning00002.yaml"), JSON.stringify(questionRecord));

    // Only HASH_B is in store, HASH_A is missing
    const store = mockStore({
      [HASH_B]: "completely new text from snapshot B",
    });

    const result = await verifyEvidence({ contentDir: dir, store });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /snapshot aaaaaaaa.* is not in the store/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
