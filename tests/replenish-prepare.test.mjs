import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml, stringify as yaml } from "yaml";
import {
  validateSelection,
  appendManifestRows,
  revalidationIds,
  guardChanges,
  changedQuestionFiles,
  statusAtRef,
  reviewIds,
  statusOnDisk,
  boundaryProblems,
  reconcileDecisions,
  demote,
  prBody,
} from "../scripts/replenish-prepare.mjs";
import { mergeVersions } from "../scripts/capture-source.mjs";

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

test("author has no R2 credentials or shell and stages only questions", () => {
  const workflow = parseYaml(
    readFileSync(new URL("../.github/workflows/content-replenish.yml", import.meta.url), "utf8"),
  );
  const steps = workflow.jobs.author.steps;
  const author = steps.find((s) => s.name === "Author agent writes review_ready questions");
  assert.equal(author.env, undefined);
  assert.match(author.with.claude_args, /--tools "Read,Glob,Grep,Write,Edit"/);
  assert.doesNotMatch(author.with.claude_args, /Bash/);
  const gates = steps.find((s) => s.name === "Deterministic gates on the authored content");
  assert.ok(gates.run.indexOf("git diff --exit-code") < gates.run.indexOf("node scripts/"));
  assert.ok(gates.env.R2_SECRET_ACCESS_KEY);
  const commit = steps.find((s) => s.name === "Commit and push the authored branch");
  assert.match(commit.run, /git add content\/questions\//);
  assert.doesNotMatch(commit.run, /git add content\/\s/);
});

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
      ["src-quotas", ["id already taken", "url already selected under another id"]],
      ["Bad Id", ["bad id", "url already selected under another id"]],
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
  schema_version: 1,
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
  const dir = questionsDir([q("q-a1a1a1a1a1a1", "review_ready", "src-quotas")]);
  try {
    demote(dir, ["q-a1a1a1a1a1a1"]);
    const after = parseYaml(readFileSync(join(dir, "questions", "q-a1a1a1a1a1a1.yaml"), "utf8"));
    assert.equal(after.status, "needs_review");
    assert.equal(after.reviewed, undefined);
    assert.equal(after.evidence[0].source_id, "src-quotas");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prBody lists captured sources, offered-but-not-captured pages, review outcome and Mock movement", () => {
  const body = prBody({
    candidates: {
      ...CANDIDATES,
      unreachable: [
        { id: "src-gone", url: "https://docs.nebius.com/gone.md", status: 404, message: "HTTP 404" },
      ],
    },
    receipt: {
      reviewer: "agent:claude-reviewer",
      reviewed_at: "2026-09-07T07:00:00Z",
      questions: [
        { id: "q-ok", approved: true, reason: "supported" },
        { id: "q-no", approved: false, reason: "two options are best" },
      ],
    },
    captured: ["src-embeddings", "src-quotas"],
    selected: [
      {
        id: "src-embeddings",
        url: "https://docs.tokenfactory.nebius.com/embeddings.md",
        title: "Embeddings",
        objectives: [],
      },
    ],
    before: [
      { course: "agentic-ai-builder", published: 69, domains: [{ id: "domain-2", mockShortfall: 3 }] },
    ],
    after: [{ course: "agentic-ai-builder", published: 74, domains: [{ id: "domain-2", mockShortfall: 0 }] }],
    dropped: [{ row: { id: "src-rerank" }, why: ["no objective from the course maps"] }],
    max: 5,
  });
  assert.match(
    body,
    /- new `src-embeddings` — Embeddings: https:\/\/docs\.tokenfactory\.nebius\.com\/embeddings\.md/,
  );
  assert.match(body, /re-captured `src-quotas` \[behavior_changed\]/);
  assert.match(
    body,
    /not captured this run\n\n- Rerank — https:\/\/docs\.tokenfactory\.nebius\.com\/rerank\.md/,
  );
  assert.ok(!/not captured this run[\s\S]*embeddings\.md/.test(body));
  assert.match(body, /`src-gone` page gone \(HTTP 404\)/);
  assert.match(body, /1 approved and promoted, 1 rejected\. Cap for this run: 5 question files\./);
  assert.match(body, /rejected `q-no`: two options are best/);
  assert.match(body, /domain-2 3→0 \(published 69→74\)/);
  assert.match(body, /dropped selection "src-rerank"/);
  assert.match(body, /Attestation is signed by the human/);
});

test("guardChanges rejects a non-integer cap instead of silently passing", () => {
  assert.match(guardChanges({ changed: [], statusAtBase: () => null, max: NaN })[0], /cap must be/);
});

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "academy-guard-"));
  const run = (args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "t@example.com"]);
  run(["config", "user.name", "t"]);
  mkdirSync(join(dir, "content", "questions"), { recursive: true });
  return { dir, run };
}

test("changedQuestionFiles sees untracked files, and the guard caps and protects against a real base", () => {
  const { dir, run } = gitRepo();
  try {
    writeFileSync(
      join(dir, "content", "questions", "q-pub000000001.yaml"),
      yaml(q("q-pub000000001", "published", "src-a")),
    );
    writeFileSync(
      join(dir, "content", "questions", "q-nrv000000001.yaml"),
      yaml(q("q-nrv000000001", "needs_review", "src-a")),
    );
    run(["add", "-A"]);
    run(["commit", "-q", "-m", "base"]);
    const base = run(["rev-parse", "HEAD"]).trim();
    // The author job's dominant output: brand-new, untracked files.
    writeFileSync(
      join(dir, "content", "questions", "q-new000000001.yaml"),
      yaml(q("q-new000000001", "review_ready", "src-a")),
    );
    writeFileSync(
      join(dir, "content", "questions", "q-new000000002.yaml"),
      yaml(q("q-new000000002", "review_ready", "src-a")),
    );
    writeFileSync(
      join(dir, "content", "questions", "q-nrv000000001.yaml"),
      yaml(q("q-nrv000000001", "review_ready", "src-a")),
    );
    const changed = changedQuestionFiles({ base, cwd: dir });
    assert.deepEqual(changed, [
      "content/questions/q-new000000001.yaml",
      "content/questions/q-new000000002.yaml",
      "content/questions/q-nrv000000001.yaml",
    ]);
    const statusAtBase = (file) => statusAtRef({ base, file, cwd: dir });
    assert.equal(statusAtBase("content/questions/q-new000000001.yaml"), null);
    assert.equal(statusAtBase("content/questions/q-pub000000001.yaml"), "published");
    assert.deepEqual(guardChanges({ changed, statusAtBase, max: 3 }), []);
    assert.match(guardChanges({ changed, statusAtBase, max: 2 })[0], /3 question files changed, cap is 2/);
    // Touching a published file is caught even when it is the only change.
    writeFileSync(
      join(dir, "content", "questions", "q-pub000000001.yaml"),
      yaml(q("q-pub000000001", "published", "src-b")),
    );
    const problems = guardChanges({
      changed: changedQuestionFiles({ base, cwd: dir }),
      statusAtBase,
      max: 10,
    });
    assert.ok(problems.some((p) => /q-pub000000001\.yaml was published/.test(p)));
    assert.deepEqual(reviewIds({ base, cwd: dir }), ["q-new000000001", "q-new000000002", "q-nrv000000001"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guardChanges with statusNow refuses a file the agent left published or retired", () => {
  const { dir, run } = gitRepo();
  try {
    run(["commit", "-q", "--allow-empty", "-m", "base"]);
    const base = run(["rev-parse", "HEAD"]).trim();
    writeFileSync(
      join(dir, "content", "questions", "q-new000000001.yaml"),
      yaml(q("q-new000000001", "published", "src-a")),
    );
    writeFileSync(
      join(dir, "content", "questions", "q-new000000002.yaml"),
      yaml(q("q-new000000002", "review_ready", "src-a")),
    );
    const changed = changedQuestionFiles({ base, cwd: dir });
    const statusAtBase = (file) => statusAtRef({ base, file, cwd: dir });
    // The post-promotion rule alone would let a self-published new file through.
    assert.deepEqual(guardChanges({ changed, statusAtBase, max: 5 }), []);
    const problems = guardChanges({
      changed,
      statusAtBase,
      max: 5,
      statusNow: (file) => statusOnDisk({ file, cwd: dir }),
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /q-new000000001\.yaml is published after authoring/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guardChanges skips the cap when max is null and rejects an unparseable file", () => {
  const changed = ["a.yaml", "b.yaml", "c.yaml"];
  // The post-promotion call: the set includes items the mechanical
  // re-validation repaired, which were never the agent's to cap.
  assert.deepEqual(guardChanges({ changed, statusAtBase: () => null, max: null }), []);
  assert.match(guardChanges({ changed, statusAtBase: () => null, max: 2 })[0], /cap is 2/);
  assert.match(
    guardChanges({
      changed: ["a.yaml"],
      statusAtBase: () => null,
      max: null,
      statusNow: () => "unparseable",
    })[0],
    /not parseable YAML/,
  );
});

test("statusOnDisk reports a corrupt file rather than passing it as absent", () => {
  const { dir } = gitRepo();
  try {
    writeFileSync(join(dir, "content", "questions", "q-broken00001.yaml"), "status: [unclosed\n");
    assert.equal(statusOnDisk({ file: "content/questions/q-broken00001.yaml", cwd: dir }), "unparseable");
    assert.equal(statusOnDisk({ file: "content/questions/q-absent000001.yaml", cwd: dir }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validateSelection refuses the same offered url under two ids", () => {
  const { rows, dropped } = validateSelection({
    select: [
      {
        id: "src-embeddings",
        url: "https://docs.tokenfactory.nebius.com/embeddings.md",
        title: "A",
        objectives: ["domain-2/embeddings-and-rerank"],
      },
      {
        id: "src-embeddings-2",
        url: "https://docs.tokenfactory.nebius.com/embeddings.md",
        title: "B",
        objectives: ["domain-2/embeddings-and-rerank"],
      },
    ],
    candidates: CANDIDATES,
    objectives: OBJECTIVES,
    existingIds: new Set(),
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(dropped[0].why, ["url already selected under another id"]);
});

test("boundaryProblems passes over the workflow's own scratch files and catches a real intruder", () => {
  const { dir, run } = gitRepo();
  try {
    // A repository that looks like the workspace at the pre-agent commit.
    writeFileSync(join(dir, ".gitignore"), "node_modules\n_run/\n.env\n*.log\n");
    writeFileSync(
      join(dir, "content", "questions", "q-base00000001.yaml"),
      yaml(q("q-base00000001", "published", "src-a")),
    );
    mkdirSync(join(dir, "content", "sources"), { recursive: true });
    writeFileSync(join(dir, "content", "sources", "src-a.yaml"), yaml({ id: "src-a" }));
    run(["add", "-A"]);
    run(["commit", "-q", "-m", "pre-agent"]);
    const base = run(["rev-parse", "HEAD"]).trim();

    // Everything the workflow itself writes between the base commit and this
    // check. Before _run/ existed these were untracked at the repository root
    // and made the boundary check fail on every run, whatever the agent did.
    mkdirSync(join(dir, "_run", "captured"), { recursive: true });
    for (const f of [
      "candidates.json",
      "limits.json",
      "capture.tsv",
      "selected.json",
      "dropped.json",
      "revalidate.json",
      "report-before.json",
      "select.json",
      "CHANGES.md",
    ]) {
      writeFileSync(join(dir, "_run", f), "x");
    }
    writeFileSync(join(dir, "_run", "captured", "src-a.md"), "# page");
    // And what the agent is allowed to do.
    writeFileSync(
      join(dir, "content", "questions", "q-new000000001.yaml"),
      yaml(q("q-new000000001", "review_ready", "src-a")),
    );
    assert.deepEqual(boundaryProblems({ base, cwd: dir }), []);

    // An ignored path is still a path the credentialed step would load, so
    // .gitignore must not exempt anything: only _run/ and node_modules/ are.
    mkdirSync(join(dir, "node_modules", "yaml"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "yaml", "index.js"), "module.exports = {};");
    assert.deepEqual(boundaryProblems({ base, cwd: dir }), []);
    writeFileSync(join(dir, ".env"), "R2_SECRET_ACCESS_KEY=stolen\n");
    writeFileSync(join(dir, "run.log"), "x");
    assert.deepEqual(boundaryProblems({ base, cwd: dir }).sort(), [
      ".env was created outside content/questions",
      "run.log was created outside content/questions",
    ]);
    rmSync(join(dir, ".env"));
    rmSync(join(dir, "run.log"));

    // A source record the agent created: untracked, so git diff cannot see it.
    writeFileSync(join(dir, "content", "sources", "src-evil.yaml"), yaml({ id: "src-evil" }));
    // A validator the agent edited: tracked, so git diff can.
    writeFileSync(join(dir, "content", "sources", "src-a.yaml"), yaml({ id: "src-a", tampered: true }));
    const problems = boundaryProblems({ base, cwd: dir });
    assert.deepEqual(problems.sort(), [
      "content/sources/src-a.yaml was changed outside content/questions",
      "content/sources/src-evil.yaml was created outside content/questions",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reconcileDecisions scopes the reviewer's output to the items under review", () => {
  const ids = ["q-aaa000000001", "q-bbb000000002"];
  const ok = reconcileDecisions({
    ids,
    decisions: [
      { id: "q-aaa000000001", approved: true, reason: "x" },
      { id: "q-bbb000000002", approved: false, reason: "y" },
    ],
  });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.decisions.length, 2);
  const bad = reconcileDecisions({
    ids,
    decisions: [
      { id: "q-aaa000000001", approved: true, reason: "x" },
      { id: "q-zzz000000009", approved: true, reason: "unrelated pre-existing item" },
    ],
  });
  assert.match(bad.problems[0], /not under review: q-zzz000000009/);
  assert.match(bad.problems[1], /no decision for: q-bbb000000002/);
  assert.deepEqual(
    bad.decisions.map((d) => d.id),
    ["q-aaa000000001"],
  );
});

test("mergeVersions keeps every earlier hash of a re-captured source", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  const C = "c".repeat(64);
  assert.deepEqual(mergeVersions(null, A), []);
  assert.deepEqual(mergeVersions({ sha256: A, status: "drifted" }, B), [A]);
  assert.deepEqual(mergeVersions({ sha256: B, status: "drifted", versions: [A] }, C), [A, B]);
  // Re-capturing identical bytes adds nothing.
  assert.deepEqual(mergeVersions({ sha256: B, status: "drifted", versions: [A] }, B), [A]);
  // A source nobody marked drifted gets no carry-over of its CURRENT hash:
  // dependents pinned to it must fail the evidence check, not pass on a
  // versions entry.
  assert.deepEqual(mergeVersions({ sha256: A, status: "current" }, B), []);
  // ...but hashes an earlier drift already registered survive that refresh.
  // Dropping them would turn Content evidence red for every needs_review item
  // pinned to one, on an ordinary full re-capture.
  assert.deepEqual(mergeVersions({ sha256: B, status: "current", versions: [A] }, C), [A]);
  assert.deepEqual(mergeVersions({ sha256: C, status: "current", versions: [A, B] }, C), [A, B]);
});
