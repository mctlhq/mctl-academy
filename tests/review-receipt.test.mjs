import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as yaml } from "yaml";
import { buildReceipt, entriesElsewhere, supersedeElsewhere } from "../scripts/review-receipt.mjs";
import { questionFingerprint } from "../scripts/lib/question-review.mjs";
import { receiptProblems } from "../scripts/lib/content-model.mjs";

const HASH = "b".repeat(64);
const question = (over = {}) => ({
  schema_version: 1,
  id: "q-abc123abc123",
  course_id: "agentic-ai-builder",
  status: "review_ready",
  domain: "domain-1",
  objective: "domain-1/quotas",
  stem: "Which value is the default?",
  options: [
    { id: "a", text: "10", correct: true, explanation: "yes" },
    { id: "b", text: "20", correct: false, explanation: "no" },
    { id: "c", text: "30", correct: false, explanation: "no" },
    { id: "d", text: "40", correct: false, explanation: "no" },
  ],
  evidence: [{ source_id: "src-quotas", source_sha256: HASH, excerpt: "Default limit is 10 GPUs" }],
  authored: { by: "agent:claude-author", at: "2026-09-07T06:00:00Z" },
  ...over,
});

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "academy-receipt-"));
  mkdirSync(join(dir, "questions"));
  for (const [id, data] of Object.entries(files))
    writeFileSync(join(dir, "questions", `${id}.yaml`), yaml(data));
  return dir;
}

const NOW = new Date("2026-09-07T07:00:00Z");

test("buildReceipt fingerprints the file on disk and the entry satisfies the lint", () => {
  const dir = fixture({ "q-abc123abc123": question() });
  try {
    const receipt = buildReceipt({
      contentDir: dir,
      reviewer: "agent:claude-reviewer",
      decisions: [{ id: "q-abc123abc123", approved: true, reason: "evidence supports a" }],
      now: NOW,
    });
    assert.equal(receipt.reviewer, "agent:claude-reviewer");
    assert.equal(receipt.reviewed_at, "2026-09-07T07:00:00Z");
    const onDisk = parseYaml(readFileSync(join(dir, "questions", "q-abc123abc123.yaml"), "utf8"));
    assert.equal(receipt.questions[0].content_sha256, questionFingerprint(onDisk));

    // What the lint will do once the item is promoted with this fingerprint.
    const receipts = new Map([[`agent:claude-reviewer|q-abc123abc123`, receipt.questions[0]]]);
    const promoted = {
      ...onDisk,
      status: "published",
      reviewed: {
        by: "agent:claude-reviewer",
        at: NOW.toISOString(),
        content_sha256: receipt.questions[0].content_sha256,
      },
    };
    assert.deepEqual(receiptProblems(promoted, receipts), []);

    // Mutation: editing the material after the receipt makes it stale.
    const edited = { ...promoted, stem: "Which value is the maximum?" };
    edited.reviewed = { ...edited.reviewed, content_sha256: questionFingerprint(edited) };
    assert.match(receiptProblems(edited, receipts)[0], /different revision/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildReceipt refuses duplicates, unknown ids, non-review_ready items and self-review", () => {
  const dir = fixture({
    "q-abc123abc123": question(),
    "q-pub001pub001": question({ id: "q-pub001pub001", status: "published" }),
    "q-self01self01": question({
      id: "q-self01self01",
      authored: { by: "agent:claude-reviewer", at: "2026-09-07T06:00:00Z" },
    }),
  });
  const build = (decisions) => () =>
    buildReceipt({ contentDir: dir, reviewer: "agent:claude-reviewer", decisions, now: NOW });
  try {
    assert.throws(
      build([
        { id: "q-abc123abc123", approved: true, reason: "x" },
        { id: "q-abc123abc123", approved: false, reason: "y" },
      ]),
      /duplicate decision/,
    );
    assert.throws(build([{ id: "q-nope00nope00", approved: true, reason: "x" }]), /no such question/);
    assert.throws(build([{ id: "q-short", approved: true, reason: "x" }]), /valid id/);
    assert.throws(build([{ id: "q-pub001pub001", approved: true, reason: "x" }]), /status is published/);
    assert.throws(build([{ id: "q-self01self01", approved: true, reason: "x" }]), /cannot review it/);
    assert.throws(build([{ id: "q-abc123abc123", approved: "yes", reason: "x" }]), /approved must be/);
    assert.throws(build([{ id: "q-abc123abc123", approved: false, reason: " " }]), /reason is required/);
    assert.throws(build([]), /non-empty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildReceipt merges into an existing receipt by replacing entries in place", () => {
  const dir = fixture({ "q-abc123abc123": question(), "q-def456def456": question({ id: "q-def456def456" }) });
  try {
    const existing = {
      reviewer: "agent:claude-reviewer",
      reviewed_at: "2026-09-01T00:00:00Z",
      questions: [
        { id: "q-abc123abc123", content_sha256: "0".repeat(64), approved: false, reason: "old" },
        { id: "q-zzz999zzz999", content_sha256: "1".repeat(64), approved: true, reason: "kept" },
      ],
    };
    const receipt = buildReceipt({
      contentDir: dir,
      reviewer: "agent:claude-reviewer",
      decisions: [
        { id: "q-abc123abc123", approved: true, reason: "re-reviewed" },
        { id: "q-def456def456", approved: false, reason: "two options are best" },
      ],
      existing,
      now: NOW,
    });
    assert.deepEqual(
      receipt.questions.map((q) => [q.id, q.approved]),
      [
        ["q-zzz999zzz999", true],
        ["q-abc123abc123", true],
        ["q-def456def456", false],
      ],
    );
    assert.equal(receipt.questions.filter((q) => q.id === "q-abc123abc123").length, 1);
    // Carried-over entries keep the timestamp of the review that produced them.
    assert.equal(
      receipt.questions.find((q) => q.id === "q-zzz999zzz999").reviewed_at,
      "2026-09-01T00:00:00Z",
    );
    assert.equal(
      receipt.questions.find((q) => q.id === "q-abc123abc123").reviewed_at,
      "2026-09-07T07:00:00Z",
    );
    assert.throws(
      () =>
        buildReceipt({
          contentDir: dir,
          reviewer: "agent:other",
          decisions: [{ id: "q-abc123abc123", approved: true, reason: "x" }],
          existing,
          now: NOW,
        }),
      /belongs to agent:claude-reviewer/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("merging into a receipt that was already superseded keeps the audit trail", () => {
  const dir = fixture({ "q-abc123abc123": question() });
  try {
    // supersedeElsewhere wrote this entry on purpose: the fingerprint is what
    // bound the earlier approval to the bytes reviewed on the day. Rebuilding
    // the receipt from reviewer/questions alone would erase it on the manual
    // append path, where the loss is a commit rather than a discarded runner.
    const superseded = [
      {
        id: "q-old111old111",
        content_sha256: "2".repeat(64),
        approved: true,
        reason: "approved before the drift",
        superseded_at: "2026-09-02T00:00:00Z",
      },
    ];
    const receipt = buildReceipt({
      contentDir: dir,
      reviewer: "agent:claude-reviewer",
      decisions: [{ id: "q-abc123abc123", approved: true, reason: "fine" }],
      existing: {
        reviewer: "agent:claude-reviewer",
        reviewed_at: "2026-09-01T00:00:00Z",
        questions: [],
        superseded,
      },
      now: NOW,
    });
    assert.deepEqual(receipt.superseded, superseded);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildReceipt refuses an id the same reviewer already holds in another receipt file", () => {
  const dir = fixture({ "q-abc123abc123": question() });
  const reviews = join(dir, "reviews");
  mkdirSync(reviews);
  writeFileSync(
    join(reviews, "older-review.json"),
    JSON.stringify({
      reviewer: "agent:claude-reviewer",
      reviewed_at: "2026-09-01T00:00:00Z",
      questions: [{ id: "q-abc123abc123", content_sha256: "0".repeat(64), approved: true, reason: "old" }],
    }),
  );
  try {
    const elsewhere = entriesElsewhere(join(reviews, "newer-review.json"));
    assert.equal(elsewhere.get("agent:claude-reviewer|q-abc123abc123"), join(reviews, "older-review.json"));
    const decisions = [{ id: "q-abc123abc123", approved: true, reason: "again" }];
    assert.throws(
      () =>
        buildReceipt({ contentDir: dir, reviewer: "agent:claude-reviewer", decisions, elsewhere, now: NOW }),
      /already has an entry in .*older-review\.json/,
    );
    // A different reviewer is not blocked by it.
    assert.ok(buildReceipt({ contentDir: dir, reviewer: "agent:other", decisions, elsewhere, now: NOW }));
    // Re-review after a later drift: supersede the older entry, then the new
    // receipt is the only one that names the id for this reviewer.
    const removed = supersedeElsewhere({
      out: join(reviews, "newer-review.json"),
      reviewer: "agent:claude-reviewer",
      ids: ["q-abc123abc123"],
    });
    assert.deepEqual(removed, [{ id: "q-abc123abc123", file: join(reviews, "older-review.json") }]);
    const older = JSON.parse(readFileSync(join(reviews, "older-review.json"), "utf8"));
    // Out of `questions`, so the lint sees exactly one decision for the id...
    assert.deepEqual(older.questions, []);
    // ...but the fingerprint that bound the original approval to the bytes
    // reviewed that day is kept as the audit record, not erased.
    assert.equal(older.superseded.length, 1);
    assert.equal(older.superseded[0].id, "q-abc123abc123");
    assert.equal(older.superseded[0].content_sha256, "0".repeat(64));
    assert.equal(older.superseded[0].reason, "old");
    assert.match(older.superseded[0].superseded_at, /^\d{4}-\d{2}-\d{2}T/);
    const again = entriesElsewhere(join(reviews, "newer-review.json"));
    assert.ok(
      buildReceipt({
        contentDir: dir,
        reviewer: "agent:claude-reviewer",
        decisions,
        elsewhere: again,
        now: NOW,
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI validates before superseding: a rejected decision leaves the earlier receipt intact", () => {
  const dir = fixture({
    "q-abc123abc123": question(),
    "q-pub001pub001": question({ id: "q-pub001pub001", status: "published" }),
  });
  const reviews = join(dir, "reviews");
  mkdirSync(reviews);
  const older = join(reviews, "older-review.json");
  const olderReceipt = {
    reviewer: "agent:claude-reviewer",
    reviewed_at: "2026-09-01T00:00:00Z",
    questions: [{ id: "q-abc123abc123", content_sha256: "0".repeat(64), approved: true, reason: "old" }],
  };
  writeFileSync(older, JSON.stringify(olderReceipt));
  const decisions = join(dir, "decisions.json");
  // The second decision is invalid (the item is published, not review_ready),
  // so buildReceipt throws — after supersedeElsewhere would have run, under
  // the old ordering.
  writeFileSync(
    decisions,
    JSON.stringify([
      { id: "q-abc123abc123", approved: true, reason: "re-reviewed" },
      { id: "q-pub001pub001", approved: true, reason: "not review_ready" },
    ]),
  );
  try {
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [
          fileURLToPath(new URL("../scripts/review-receipt.mjs", import.meta.url)),
          "--reviewer",
          "agent:claude-reviewer",
          "--decisions",
          decisions,
          "--out",
          join(reviews, "newer-review.json"),
          "--supersede",
        ],
        { env: { ...process.env, ACADEMY_CONTENT_DIR: dir }, stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    // The approval it already owned is still there, and no half-written receipt.
    assert.deepEqual(JSON.parse(readFileSync(older, "utf8")), olderReceipt);
    assert.equal(existsSync(join(reviews, "newer-review.json")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
