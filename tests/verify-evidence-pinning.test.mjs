import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyEvidence, requiresVerification } from "../scripts/verify-evidence.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

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

test("evidence pinned to HASH_A verifies against HASH_A snapshot when registered in source versions", async () => {
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
      versions: [HASH_A, HASH_B],
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

test("fails verification if mandatory source_sha256 is missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-pinning-missing-"));
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
      id: "q-pinning00003",
      course_id: "agentic-ai-builder",
      status: "published",
      domain: "domain-1",
      objective: "domain-1/alpha",
      stem: "Question missing source_sha256",
      options: [
        { id: "a", text: "Correct", correct: true, explanation: "Valid explanation" },
        { id: "b", text: "Wrong 1", correct: false, explanation: "Valid explanation" },
        { id: "c", text: "Wrong 2", correct: false, explanation: "Valid explanation" },
        { id: "d", text: "Wrong 3", correct: false, explanation: "Valid explanation" },
      ],
      evidence: [
        {
          source_id: "src-pinning-test",
          // missing source_sha256
          excerpt: "some text",
        },
      ],
      authored: { by: "agent:writer", at: "2026-08-06T10:00:00Z" },
      reviewed: { by: "mashkovd", at: "2026-08-06T11:00:00Z" },
    };

    writeFileSync(join(dir, "sources", "src-pinning-test.yaml"), JSON.stringify(sourceRecord));
    writeFileSync(join(dir, "questions", "q-pinning00003.yaml"), JSON.stringify(questionRecord));

    const store = mockStore({ [HASH_B]: "some text" });
    const result = await verifyEvidence({ contentDir: dir, store });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /missing mandatory source_sha256/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails verification if source_sha256 does not belong to declared source_id provenance", async () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-pinning-provenance-"));
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
      versions: [HASH_B], // Only HASH_B is registered
      objectives: ["domain-1/alpha"],
      snapshot: { bucket: "academy-source-snapshots", key: HASH_B },
    };

    const questionRecord = {
      schema_version: 1,
      id: "q-pinning00004",
      course_id: "agentic-ai-builder",
      status: "published",
      domain: "domain-1",
      objective: "domain-1/alpha",
      stem: "Question with unmapped hash C",
      options: [
        { id: "a", text: "Correct", correct: true, explanation: "Valid explanation" },
        { id: "b", text: "Wrong 1", correct: false, explanation: "Valid explanation" },
        { id: "c", text: "Wrong 2", correct: false, explanation: "Valid explanation" },
        { id: "d", text: "Wrong 3", correct: false, explanation: "Valid explanation" },
      ],
      evidence: [
        {
          source_id: "src-pinning-test",
          source_sha256: HASH_C, // HASH_C does not belong to src-pinning-test
          excerpt: "some text",
        },
      ],
      authored: { by: "agent:writer", at: "2026-08-06T10:00:00Z" },
      reviewed: { by: "mashkovd", at: "2026-08-06T11:00:00Z" },
    };

    writeFileSync(join(dir, "sources", "src-pinning-test.yaml"), JSON.stringify(sourceRecord));
    writeFileSync(join(dir, "questions", "q-pinning00004.yaml"), JSON.stringify(questionRecord));

    const store = mockStore({ [HASH_C]: "some text" });
    const result = await verifyEvidence({ contentDir: dir, store });
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /does not belong to declared source/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
