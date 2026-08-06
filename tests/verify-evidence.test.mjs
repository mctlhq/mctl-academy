/**
 * The citation gate, tested by breaking it.
 *
 * The store is injected, so these run offline and deterministically — no
 * credentials, no network, no dependence on what happens to be in the bucket.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { verifyEvidence, normalize, requiresVerification } from "../scripts/verify-evidence.mjs";

const sha256 = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

const DOC = "Function calling lets a model request tools that your application then executes and returns results for.";
const DOC_HASH = sha256(DOC);

/** In-memory stand-in for the R2 store. */
const fakeStore = (objects) => ({
  async get(key) {
    if (!(key in objects)) return null;
    if (objects[key] instanceof Error) throw objects[key];
    return objects[key];
  },
});

function tree({ sources, items }) {
  const dir = mkdtempSync(join(tmpdir(), "academy-ev-"));
  mkdirSync(join(dir, "sources"), { recursive: true });
  mkdirSync(join(dir, "questions"), { recursive: true });
  sources.forEach((s, i) => writeFileSync(join(dir, "sources", `s${i}.yaml`), JSON.stringify(s)));
  items.forEach((q, i) => writeFileSync(join(dir, "questions", `q${i}.yaml`), JSON.stringify(q)));
  return dir;
}

const source = (over = {}) => ({
  id: "src-fn-calling",
  url: "https://docs.tokenfactory.nebius.com/ai-models-inference/function-calling",
  sha256: DOC_HASH,
  snapshot: { bucket: "academy-source-snapshots", key: DOC_HASH },
  ...over,
});

const item = (over = {}) => ({
  id: "q-abcdef123456",
  status: "published",
  evidence: [{ source_id: "src-fn-calling", excerpt: "lets a model request tools" }],
  ...over,
});

async function run({ sources = [source()], items = [item()], objects = { [DOC_HASH]: DOC }, store }) {
  const dir = tree({ sources, items });
  try {
    return await verifyEvidence({
      contentDir: dir,
      store: store === undefined ? fakeStore(objects) : store,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("passes when the excerpt appears verbatim", async () => {
  const { errors, checked } = await run({});
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
});

test("fails when the excerpt does not appear", async () => {
  const items = [item({ evidence: [{ source_id: "src-fn-calling", excerpt: "lets a model invent tools" }] })];
  const { errors } = await run({ items });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not found verbatim/);
});

test("fails a paraphrase that preserves meaning", async () => {
  // The whole point: semantically identical, textually different.
  const items = [item({ evidence: [{ source_id: "src-fn-calling", excerpt: "allows a model to request tools" }] })];
  const { errors } = await run({ items });
  assert.equal(errors.length, 1);
});

test("tolerates line wrapping in the stored document", async () => {
  const wrapped = DOC.replace("request tools", "request\ntools");
  const key = sha256(wrapped);
  const { errors, checked } = await run({
    sources: [source({ sha256: key, snapshot: { bucket: "academy-source-snapshots", key } })],
    objects: { [key]: wrapped },
  });
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
});

test("tolerates curly quotes in the stored document", async () => {
  const curly = "The model’s response includes a tool call.";
  const key = sha256(curly);
  const items = [item({ evidence: [{ source_id: "src-fn-calling", excerpt: "The model's response" }] })];
  const { errors } = await run({
    sources: [source({ snapshot: { bucket: "academy-source-snapshots", key } })],
    items,
    objects: { [key]: curly },
  });
  assert.deepEqual(errors, []);
});

test("does not fold case — case is meaning", async () => {
  const items = [item({ evidence: [{ source_id: "src-fn-calling", excerpt: "LETS A MODEL REQUEST TOOLS" }] })];
  const { errors } = await run({ items });
  assert.equal(errors.length, 1);
});

test("fails when the snapshot is absent from the store", async () => {
  const { errors } = await run({ objects: {} });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not in the store/);
});

test("fails when the source records no snapshot", async () => {
  const s = source();
  delete s.snapshot;
  const { errors } = await run({ sources: [s] });
  assert.match(errors[0], /no snapshot recorded/);
});

test("fails when the citation names an unknown source", async () => {
  const items = [item({ evidence: [{ source_id: "src-nope", excerpt: "anything" }] })];
  const { errors } = await run({ items });
  assert.match(errors[0], /unknown source/);
});

test("propagates a corrupt-snapshot error from the store", async () => {
  const { errors } = await run({
    objects: { [DOC_HASH]: new Error("snapshot is corrupt: stored bytes hash to deadbeef") },
  });
  assert.match(errors[0], /corrupt/);
});

test("skips drafts — an unverified draft is not a live claim", async () => {
  const { errors, checked, skipped } = await run({ items: [item({ status: "draft" })], objects: {} });
  assert.deepEqual(errors, []);
  assert.equal(checked, 0);
  assert.equal(skipped, 1);
});

test("still enforces items withdrawn as needs_review", async () => {
  // These were published once, so their citations must keep verifying even
  // while they are out of selection.
  const { errors } = await run({ items: [item({ status: "needs_review" })], objects: {} });
  assert.equal(errors.length, 1);
});

test("fails closed when the store is unconfigured but content is published", async () => {
  const { errors } = await run({ store: null });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Refusing to pass unverified content/);
});

test("passes with no store when nothing is published", async () => {
  const { errors } = await run({ items: [item({ status: "draft" })], store: null });
  assert.deepEqual(errors, []);
});

// Regression: the store-unconfigured guard once filtered on `published` alone
// while per-item enforcement used `published || needs_review`. A repo holding
// only needs_review items therefore passed with no store at all — fail-open,
// and silently. Both paths now consult requiresVerification().
test("fails closed when the store is unconfigured and only needs_review items exist", async () => {
  const { errors } = await run({ items: [item({ status: "needs_review" })], store: null });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /require verification/);
});

test("requiresVerification treats published and needs_review alike, drafts not", () => {
  assert.equal(requiresVerification("published"), true);
  assert.equal(requiresVerification("needs_review"), true);
  assert.equal(requiresVerification("draft"), false);
  assert.equal(requiresVerification("retired"), false);
});

test("normalize collapses whitespace without folding case or punctuation", () => {
  assert.equal(normalize("a  b\n c"), "a b c");
  assert.equal(normalize("Don’t"), "Don't");
  assert.equal(normalize("A-B"), "A-B");
  assert.equal(normalize("Abc"), "Abc");
});
