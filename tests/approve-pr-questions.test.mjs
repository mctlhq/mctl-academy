import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { promoteQuestions, parseArgs } from "../scripts/approve-pr-questions.mjs";
import { questionFingerprint, reviewProblems } from "../scripts/lib/question-review.mjs";
import { checkBundleEligibility } from "../scripts/lib/content-model.mjs";

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

test("independent agent promotion requires a matching positive review receipt", () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-agent-review-"));
  try {
    mkdirSync(join(dir, "questions"));
    const q = sampleQuestion();
    const file = join(dir, "questions", `${q.id}.yaml`);
    const receiptFile = join(dir, "review.json");
    writeFileSync(file, JSON.stringify(q));
    const receipt = {
      reviewer: "agent:independent-reviewer",
      questions: [{ id: q.id, content_sha256: questionFingerprint(q), approved: true }],
    };
    writeFileSync(receiptFile, JSON.stringify(receipt));
    const opts = { contentDir: dir, by: receipt.reviewer, reviewFile: receiptFile, idsOrPaths: [q.id] };
    assert.equal(promoteQuestions(opts).count, 1);
    const published = parseYaml(readFileSync(file, "utf8"));
    assert.equal(published.reviewed.content_sha256, questionFingerprint(q));
    assert.deepEqual(reviewProblems(published), []);
    assert.equal(published.reviewed.by, receipt.reviewer);
    const sources = new Map([["src-auth", { id: "src-auth", snapshot: { key: HASH } }]]);
    assert.equal(checkBundleEligibility(published, sources).eligible, true);
    published.options[0].explanation += " Changed meaning.";
    assert.equal(checkBundleEligibility(published, sources).eligible, false);
    assert.match(reviewProblems(published).join(), /stale/);
    writeFileSync(file, JSON.stringify({ ...published, status: "review_ready" }));
    assert.throws(() => promoteQuestions(opts), /stale fingerprint/);
    writeFileSync(file, JSON.stringify(q));
    receipt.questions[0].approved = false;
    writeFileSync(receiptFile, JSON.stringify(receipt));
    assert.throws(() => promoteQuestions(opts), /missing approval/);
    receipt.reviewer = q.authored.by;
    receipt.questions[0].approved = true;
    writeFileSync(receiptFile, JSON.stringify(receipt));
    assert.throws(() => promoteQuestions({ ...opts, by: q.authored.by }), /self-review/);
    assert.throws(() => promoteQuestions({ ...opts, idsOrPaths: [], courseId: q.course_id }), /explicit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fingerprint ignores YAML key order and lifecycle but covers author, evidence and all options", () => {
  const q = sampleQuestion();
  const hash = questionFingerprint(q);
  assert.equal(questionFingerprint(Object.fromEntries(Object.entries(q).reverse())), hash);
  assert.equal(questionFingerprint({ ...q, status: "published", reviewed: { by: "human" } }), hash);
  for (const change of [
    { authored: { ...q.authored, by: "agent:new-writer" } },
    { evidence: [{ ...q.evidence[0], excerpt: "Different evidence" }] },
    { options: q.options.map((o) => ({ ...o, explanation: o.explanation + " Changed." })) },
  ])
    assert.notEqual(questionFingerprint({ ...q, ...change }), hash);
  assert.deepEqual(reviewProblems({ ...q, reviewed: { by: "mashkovd", at: "2026-09-05T00:00:00Z" } }), []);
  assert.match(
    reviewProblems({ ...q, reviewed: { by: "agent:reviewer", at: "2026-09-05T00:00:00Z" } }).join(),
    /requires content_sha256/,
  );
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

test("rejects promotion if reviewer is missing or an agent has no review receipt", () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-approve-"));
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    const filePath = join(dir, "questions", "q-review000001.yaml");
    writeFileSync(filePath, JSON.stringify(sampleQuestion()));

    assert.throws(
      () => promoteQuestions({ contentDir: dir, by: null, idsOrPaths: [filePath] }),
      /Maintainer handle required/,
    );

    assert.throws(
      () => promoteQuestions({ contentDir: dir, by: "agent:question-author", idsOrPaths: [filePath] }),
      /requires --review-file/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects promotion if selection modes are conflicting", () => {
  assert.throws(
    () => parseArgs(["--all-review-ready", "--course", "agentic-ai-builder"]),
    /mutually exclusive/,
  );

  assert.throws(() => parseArgs(["--all-review-ready", "q1"]), /mutually exclusive/);

  assert.throws(() => parseArgs(["--course", "agentic-ai-builder", "q1"]), /mutually exclusive/);

  const dir = mkdtempSync(join(tmpdir(), "academy-approve-"));
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    const filePath = join(dir, "questions", "q-review000001.yaml");
    writeFileSync(filePath, JSON.stringify(sampleQuestion()));

    assert.throws(
      () =>
        promoteQuestions({
          contentDir: dir,
          by: "mashkovd",
          allReviewReady: true,
          courseId: "agentic-ai-builder",
        }),
      /mutually exclusive/,
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
    writeFileSync(
      filePath,
      JSON.stringify(sampleQuestion({ authored: { by: "mashkovd", at: "2026-08-06T10:00:00Z" } })),
    );

    assert.throws(
      () => promoteQuestions({ contentDir: dir, by: "mashkovd", idsOrPaths: [filePath] }),
      /agent author/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects promotion if question status is draft, published or retired", () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-approve-"));
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    const fileDraft = join(dir, "questions", "q-draft.yaml");
    const filePub = join(dir, "questions", "q-pub.yaml");
    writeFileSync(fileDraft, JSON.stringify(sampleQuestion({ status: "draft" })));
    writeFileSync(filePub, JSON.stringify(sampleQuestion({ status: "published" })));

    assert.throws(
      () => promoteQuestions({ contentDir: dir, by: "mashkovd", idsOrPaths: [fileDraft] }),
      /Only items in "review_ready" can be promoted/,
    );

    assert.throws(
      () => promoteQuestions({ contentDir: dir, by: "mashkovd", idsOrPaths: [filePub] }),
      /Only items in "review_ready" can be promoted/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("atomic batch promotion: fails all writes if one item in batch is invalid", () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-approve-"));
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    const fileValid = join(dir, "questions", "q-valid.yaml");
    const fileInvalid = join(dir, "questions", "q-invalid.yaml");
    writeFileSync(fileValid, JSON.stringify(sampleQuestion({ id: "q-valid", status: "review_ready" })));
    writeFileSync(fileInvalid, JSON.stringify(sampleQuestion({ id: "q-invalid", status: "published" })));

    assert.throws(
      () => promoteQuestions({ contentDir: dir, by: "mashkovd", idsOrPaths: [fileValid, fileInvalid] }),
      /Only items in "review_ready" can be promoted/,
    );

    // Verify fileValid was NOT modified on disk (atomic guarantee)
    const validData = parseYaml(readFileSync(fileValid, "utf8"));
    assert.equal(validData.status, "review_ready");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("promotes all review_ready questions when allReviewReady is specified", () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-approve-"));
  try {
    mkdirSync(join(dir, "questions"), { recursive: true });
    writeFileSync(
      join(dir, "questions", "q1.yaml"),
      JSON.stringify(sampleQuestion({ id: "q-review000001" })),
    );
    writeFileSync(
      join(dir, "questions", "q2.yaml"),
      JSON.stringify(sampleQuestion({ id: "q-review000002" })),
    );
    writeFileSync(
      join(dir, "questions", "q3.yaml"),
      JSON.stringify(sampleQuestion({ id: "q-review000003", status: "published" })),
    );

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
