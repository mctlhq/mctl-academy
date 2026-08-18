import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { quarantineDriftedQuestions } from "../scripts/quarantine-drifted-questions.mjs";

const HASH = "a".repeat(64);

const sampleSource = (over = {}) => ({
  schema_version: 1,
  id: "src-auth",
  url: "https://docs.nebius.com/auth",
  title: "Authentication",
  retrieved_at: "2026-08-06T00:00:00Z",
  sha256: HASH,
  snapshot: { bucket: "academy-source-snapshots", key: HASH },
  status: "current",
  ...over,
});

const sampleQuestion = (over = {}) => ({
  schema_version: 1,
  id: "q-published01",
  course_id: "agentic-ai-builder",
  status: "published",
  domain: "domain-1",
  objective: "domain-1/api-authentication",
  stem: "Which header passes the API key in requests?",
  options: [
    { id: "a", text: "Authorization: Bearer <key>", correct: true, explanation: "Valid header format." },
    { id: "b", text: "X-Key: <key>", correct: false, explanation: "Incorrect header name." },
    { id: "c", text: "Cookie: key=<key>", correct: false, explanation: "Incorrect header type." },
    { id: "d", text: "User-Agent: key", correct: false, explanation: "Incorrect header." },
  ],
  evidence: [{ source_id: "src-auth", source_sha256: HASH, excerpt: "requests must include Authorization Bearer" }],
  authored: { by: "agent:question-author", at: "2026-08-06T10:00:00Z" },
  reviewed: { by: "mashkovd", at: "2026-08-06T11:00:00Z" },
  ...over,
});

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), "academy-quarantine-"));
  mkdirSync(join(dir, "sources"), { recursive: true });
  mkdirSync(join(dir, "questions"), { recursive: true });
  return dir;
}

test("quarantines a published question citing a drifted source", () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, "sources", "src-auth.yaml"), JSON.stringify(sampleSource({ status: "drifted" })));
    const qPath = join(dir, "questions", "q-published01.yaml");
    writeFileSync(qPath, JSON.stringify(sampleQuestion()));

    const result = quarantineDriftedQuestions({ contentDir: dir });

    assert.equal(result.totalPublished, 1);
    assert.deepEqual(result.quarantined, ["q-published01"]);

    const updated = parseYaml(readFileSync(qPath, "utf8"));
    assert.equal(updated.status, "needs_review");
    // The transition never touches evidence -- repinning happens later, in
    // revalidateContent, only once a human/agent has re-captured the source.
    assert.equal(updated.evidence[0].source_sha256, HASH);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quarantines a published question citing a deprecated source", () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, "sources", "src-auth.yaml"), JSON.stringify(sampleSource({ status: "deprecated" })));
    writeFileSync(join(dir, "questions", "q-published01.yaml"), JSON.stringify(sampleQuestion()));

    const result = quarantineDriftedQuestions({ contentDir: dir });

    assert.deepEqual(result.quarantined, ["q-published01"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("leaves a published question alone when its source is current", () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, "sources", "src-auth.yaml"), JSON.stringify(sampleSource({ status: "current" })));
    const qPath = join(dir, "questions", "q-published01.yaml");
    writeFileSync(qPath, JSON.stringify(sampleQuestion()));

    const result = quarantineDriftedQuestions({ contentDir: dir });

    assert.deepEqual(result.quarantined, []);
    assert.equal(parseYaml(readFileSync(qPath, "utf8")).status, "published");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("leaves draft and review_ready questions alone even if their source drifts", () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, "sources", "src-auth.yaml"), JSON.stringify(sampleSource({ status: "drifted" })));
    writeFileSync(
      join(dir, "questions", "q-draft01.yaml"),
      JSON.stringify(sampleQuestion({ id: "q-draft01", status: "draft" })),
    );
    writeFileSync(
      join(dir, "questions", "q-ready01.yaml"),
      JSON.stringify(sampleQuestion({ id: "q-ready01", status: "review_ready" })),
    );

    const result = quarantineDriftedQuestions({ contentDir: dir });

    assert.deepEqual(result.quarantined, []);
    assert.equal(result.totalPublished, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("is idempotent: a second run against already-quarantined content finds nothing new", () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, "sources", "src-auth.yaml"), JSON.stringify(sampleSource({ status: "drifted" })));
    writeFileSync(join(dir, "questions", "q-published01.yaml"), JSON.stringify(sampleQuestion()));

    const first = quarantineDriftedQuestions({ contentDir: dir });
    assert.deepEqual(first.quarantined, ["q-published01"]);

    const second = quarantineDriftedQuestions({ contentDir: dir });
    assert.deepEqual(second.quarantined, []);
    assert.deepEqual(second.alreadyHandled, ["q-published01"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a multi-source question is quarantined if any one citation is unusable", () => {
  const dir = makeDir();
  try {
    writeFileSync(join(dir, "sources", "src-auth.yaml"), JSON.stringify(sampleSource({ status: "current" })));
    writeFileSync(
      join(dir, "sources", "src-other.yaml"),
      JSON.stringify(sampleSource({ id: "src-other", status: "drifted" })),
    );
    const qPath = join(dir, "questions", "q-published01.yaml");
    writeFileSync(
      qPath,
      JSON.stringify(
        sampleQuestion({
          evidence: [
            { source_id: "src-auth", source_sha256: HASH, excerpt: "requests must include Authorization Bearer" },
            { source_id: "src-other", source_sha256: HASH, excerpt: "requests must include Authorization Bearer" },
          ],
        }),
      ),
    );

    const result = quarantineDriftedQuestions({ contentDir: dir });

    assert.deepEqual(result.quarantined, ["q-published01"]);
    assert.equal(parseYaml(readFileSync(qPath, "utf8")).status, "needs_review");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
