import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as yaml } from "yaml";
import {
  validateSelection,
  appendManifestRows,
  revalidationIds,
  guardChanges,
  demote,
  prBody,
} from "../scripts/replenish-prepare.mjs";

const CANDIDATES = {
  newPagesTotal: 3,
  newPages: [
    {
      url: "https://docs.tokenfactory.nebius.com/embeddings.md",
      title: "Embeddings",
      host: "docs.tokenfactory.nebius.com",
    },
    {
      url: "https://docs.tokenfactory.nebius.com/rerank.md",
      title: "Rerank",
      host: "docs.tokenfactory.nebius.com",
    },
  ],
  drifted: [
    {
      id: "src-quotas",
      url: "https://docs.nebius.com/q.md",
      classification: "behavior_changed",
      summary: "limit changed",
    },
  ],
  gaps: [],
};
const OBJECTIVES = new Set(["domain-2/embeddings-and-rerank", "domain-1/quotas"]);

test("validateSelection keeps offered urls with mapped objectives and drops the rest with reasons", () => {
  const { rows, dropped } = validateSelection({
    select: [
      {
        id: "src-embeddings",
        url: "https://docs.tokenfactory.nebius.com/embeddings.md",
        title: "Embeddings",
        objectives: ["domain-2/embeddings-and-rerank", "domain-9/made-up"],
      },
      {
        id: "src-rerank",
        url: "https://docs.tokenfactory.nebius.com/rerank.md",
        title: "Rerank",
        objectives: ["domain-9/made-up"],
      },
      { id: "src-evil", url: "https://evil.example/x.md", title: "X", objectives: ["domain-1/quotas"] },
      {
        id: "src-quotas",
        url: "https://docs.tokenfactory.nebius.com/embeddings.md",
        title: "Dup",
        objectives: ["domain-1/quotas"],
      },
      {
        id: "Bad Id",
        url: "https://docs.tokenfactory.nebius.com/embeddings.md",
        title: "Bad",
        objectives: ["domain-1/quotas"],
      },
    ],
    candidates: CANDIDATES,
    objectives: OBJECTIVES,
    existingIds: new Set(["src-quotas"]),
  });
  assert.deepEqual(rows, [
    {
      id: "src-embeddings",
      url: "https://docs.tokenfactory.nebius.com/embeddings.md",
      title: "Embeddings",
      objectives: ["domain-2/embeddings-and-rerank"],
    },
  ]);
  assert.deepEqual(
    dropped.map((d) => [d.row.id, d.why]),
    [
      ["src-rerank", ["no objective from the course maps"]],
      ["src-evil", ["url not in the discovery report"]],
      ["src-quotas", ["id already taken"]],
      ["Bad Id", ["bad id"]],
    ],
  );
});

test("appendManifestRows keeps the manifest's comments and adds the rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "academy-manifest-"));
  try {
    const file = join(dir, "capture-manifest.yaml");
    writeFileSync(
      file,
      "schema_version: 1\n\n# Pages captured by the workflow.\nsources:\n  - id: src-old\n    url: https://docs.nebius.com/old.md\n    title: Old\n    objectives:\n      - domain-1/quotas\n",
    );
    appendManifestRows(file, [
      { id: "src-new", url: "https://docs.nebius.com/new.md", title: "New", objectives: ["domain-1/quotas"] },
    ]);
    const text = readFileSync(file, "utf8");
    assert.match(text, /# Pages captured by the workflow\./);
    assert.deepEqual(
      parseYaml(text).sources.map((s) => s.id),
      ["src-old", "src-new"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function questionsDir(entries) {
  const dir = mkdtempSync(join(tmpdir(), "academy-prepare-"));
  mkdirSync(join(dir, "questions"));
  for (const q of entries) writeFileSync(join(dir, "questions", `${q.id}.yaml`), yaml(q));
  return dir;
}
const q = (id, status, source) => ({
  id,
  status,
  evidence: [{ source_id: source, source_sha256: "a".repeat(64), excerpt: "x" }],
  reviewed: { by: "mashkovd", at: "2026-01-01T00:00:00Z" },
});

test("revalidationIds lists needs_review questions citing the re-captured sources only", () => {
  const dir = questionsDir([
    q("q-a1", "needs_review", "src-quotas"),
    q("q-b2", "needs_review", "src-other"),
    q("q-c3", "published", "src-quotas"),
  ]);
  try {
    assert.deepEqual(revalidationIds({ contentDir: dir, sourceIds: ["src-quotas"] }), ["q-a1"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guardChanges enforces the cap and protects published and retired files", () => {
  const statusAtBase = (f) =>
    ({
      "content/questions/q-pub.yaml": "published",
      "content/questions/q-ret.yaml": "retired",
      "content/questions/q-nr.yaml": "needs_review",
    })[f] ?? null;
  assert.deepEqual(
    guardChanges({
      changed: ["content/questions/q-nr.yaml", "content/questions/q-new.yaml"],
      statusAtBase,
      max: 2,
    }),
    [],
  );
  const problems = guardChanges({
    changed: ["content/questions/q-pub.yaml", "content/questions/q-ret.yaml", "content/questions/q-new.yaml"],
    statusAtBase,
    max: 2,
  });
  assert.equal(problems.length, 3);
  assert.match(problems[0], /cap is 2/);
  assert.match(problems[1], /q-pub.yaml was published/);
  assert.match(problems[2], /q-ret.yaml is retired/);
});

test("demote returns a rejected re-validation to needs_review without a reviewed block", () => {
  const dir = questionsDir([q("q-a1", "review_ready", "src-quotas")]);
  try {
    demote(dir, ["q-a1"]);
    const after = parseYaml(readFileSync(join(dir, "questions", "q-a1.yaml"), "utf8"));
    assert.equal(after.status, "needs_review");
    assert.equal(after.reviewed, undefined);
    assert.equal(after.evidence[0].source_id, "src-quotas");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prBody reports sources, review outcome and Mock shortfall movement", () => {
  const body = prBody({
    candidates: CANDIDATES,
    receipt: {
      reviewer: "agent:claude-reviewer",
      reviewed_at: "2026-09-07T07:00:00Z",
      questions: [
        { id: "q-ok", approved: true, reason: "supported" },
        { id: "q-no", approved: false, reason: "two options are best" },
      ],
    },
    before: [
      { course: "agentic-ai-builder", published: 69, domains: [{ id: "domain-2", mockShortfall: 3 }] },
    ],
    after: [{ course: "agentic-ai-builder", published: 74, domains: [{ id: "domain-2", mockShortfall: 0 }] }],
    dropped: [{ row: { id: "src-rerank" }, why: ["no objective from the course maps"] }],
  });
  assert.match(body, /re-captured: `src-quotas` \[behavior_changed\]/);
  assert.match(body, /1 approved and promoted, 1 rejected/);
  assert.match(body, /rejected `q-no`: two options are best/);
  assert.match(body, /domain-2 3→0 \(published 69→74\)/);
  assert.match(body, /dropped selection "src-rerank"/);
  assert.match(body, /Attestation is signed by the human/);
});
