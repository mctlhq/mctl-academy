import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as yaml } from "yaml";
import { parseLlmsIndex, newPages, gapsFrom, rankPages, discover } from "../scripts/discover-docs.mjs";
import { sha256 } from "../scripts/lib/snapshot-store.mjs";

const OLD = "# Quotas\n\nDefault limit is 10 GPUs per project.\n";
const NEW = "# Quotas\n\nDefault limit is 20 GPUs per project.\n";
const OLD_SHA = sha256(Buffer.from(OLD, "utf8"));

const INDEX = [
  "# Nebius Token Factory documentation",
  "",
  "> blurb",
  "",
  "- [Quickstart](https://docs.tokenfactory.nebius.com/quickstart.md): Welcome",
  "- [Overview](https://docs.tokenfactory.nebius.com/ai-models-inference/overview.md)",
  "- [Overview](https://docs.tokenfactory.nebius.com/ai-models-inference/overview.md)",
  "- [Pricing](https://nebius.com/prices.md): off-allowlist host",
  "- [HTML page](https://docs.tokenfactory.nebius.com/not-markdown)",
  "- [Quotas](https://docs.nebius.com/compute/resources/quotas-limits.md): Limits",
].join("\n");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "academy-discover-"));
  for (const d of ["courses", "sources", "questions"]) mkdirSync(join(dir, d));
  writeFileSync(
    join(dir, "courses", "agentic-ai-builder.yaml"),
    yaml({
      schema_version: 1,
      id: "agentic-ai-builder",
      title: "Builder",
      mock: { question_count: 1, time_limit_minutes: 10 },
      domains: [
        {
          id: "domain-1",
          title: "D1",
          weight: 100,
          mock_questions: 1,
          objectives: [
            { id: "quotas", title: "Quotas" },
            { id: "inference-basics", title: "Inference" },
          ],
        },
      ],
    }),
  );
  writeFileSync(
    join(dir, "sources", "src-quotas.yaml"),
    yaml({
      schema_version: 1,
      id: "src-quotas",
      url: "https://docs.nebius.com/compute/resources/quotas-limits.md",
      title: "Quotas",
      retrieved_at: "2026-08-06T00:00:00Z",
      sha256: OLD_SHA,
      objectives: ["domain-1/quotas"],
      snapshot: { bucket: "b", key: OLD_SHA },
      status: "current",
    }),
  );
  writeFileSync(
    join(dir, "questions", "q-quotas0001.yaml"),
    yaml({
      schema_version: 1,
      id: "q-quotas0001",
      course_id: "agentic-ai-builder",
      status: "published",
      domain: "domain-1",
      objective: "domain-1/quotas",
      stem: "What is the default GPU quota?",
      options: [
        { id: "a", text: "10", correct: true, explanation: "yes" },
        { id: "b", text: "20", correct: false, explanation: "no" },
        { id: "c", text: "30", correct: false, explanation: "no" },
        { id: "d", text: "40", correct: false, explanation: "no" },
      ],
      evidence: [{ source_id: "src-quotas", source_sha256: OLD_SHA, excerpt: "Default limit is 10 GPUs" }],
      authored: { by: "agent:x", at: "2026-08-06T00:00:00Z" },
      reviewed: { by: "mashkovd", at: "2026-08-06T00:00:00Z" },
    }),
  );
  return dir;
}

const fakeFetch = (live) => async (url) => {
  if (url.endsWith("llms.txt")) return url.includes("tokenfactory") ? INDEX : "";
  if (url.endsWith("quotas-limits.md")) return live;
  throw new Error(`unexpected fetch ${url}`);
};
const fakeStore = { get: async (key) => (key === OLD_SHA ? OLD : null) };

test("parseLlmsIndex keeps allowlisted .md pages once, drops other hosts and non-markdown", () => {
  const pages = parseLlmsIndex(INDEX);
  assert.deepEqual(
    pages.map((p) => p.url),
    [
      "https://docs.tokenfactory.nebius.com/quickstart.md",
      "https://docs.tokenfactory.nebius.com/ai-models-inference/overview.md",
      "https://docs.nebius.com/compute/resources/quotas-limits.md",
    ],
  );
  assert.equal(pages[0].description, "Welcome");
  assert.equal(pages[1].description, "");
});

test("newPages excludes known and ignored urls and orders by first-seen date", () => {
  const pages = parseLlmsIndex(INDEX);
  const known = new Set(["https://docs.nebius.com/compute/resources/quotas-limits.md"]);
  const state = {
    seen: [
      {
        url: "https://docs.tokenfactory.nebius.com/ai-models-inference/overview.md",
        first_seen: "2026-08-01",
      },
    ],
    ignored: [],
  };
  const fresh = newPages({ pages, known, state, today: "2026-09-07" });
  assert.deepEqual(
    fresh.map((p) => [p.url, p.first_seen]),
    [
      ["https://docs.tokenfactory.nebius.com/ai-models-inference/overview.md", "2026-08-01"],
      ["https://docs.tokenfactory.nebius.com/quickstart.md", "2026-09-07"],
    ],
  );
  state.ignored.push({ url: "https://docs.tokenfactory.nebius.com/quickstart.md", reason: "marketing" });
  assert.equal(newPages({ pages, known, state, today: "2026-09-07" }).length, 1);
});

test("gapsFrom reports Mock shortfalls and thin objectives, thinnest first", () => {
  const gaps = gapsFrom(
    [
      {
        course: "c",
        domains: [
          {
            id: "domain-1",
            published: 1,
            mockNeeded: 2,
            mockShortfall: 1,
            objectives: [
              { id: "quotas", published: 1 },
              { id: "inference-basics", published: 0 },
            ],
          },
        ],
      },
    ],
    3,
  );
  assert.deepEqual(
    gaps.map((g) => [g.kind, g.objective ?? g.domain, g.published]),
    [
      ["objective", "domain-1/inference-basics", 0],
      ["mock-shortfall", "domain-1", 1],
      ["objective", "domain-1/quotas", 1],
    ],
  );
});

test("discover: a source that still says current but changed live is drifted and classified", async () => {
  const dir = fixture();
  try {
    const warnings = [];
    const { result, nextState } = await discover({
      contentDir: dir,
      checkLive: true,
      maxNew: 1,
      today: "2026-09-07",
      fetch: fakeFetch(NEW),
      store: fakeStore,
      warn: (m) => warnings.push(m),
    });
    assert.equal(result.empty, false);
    assert.equal(result.newPagesTotal, 2);
    assert.deepEqual(
      result.newPages.map((p) => p.url),
      ["https://docs.tokenfactory.nebius.com/ai-models-inference/overview.md"],
    );
    assert.equal(result.drifted.length, 1);
    assert.equal(result.drifted[0].id, "src-quotas");
    assert.equal(result.drifted[0].recordedStatus, "current");
    assert.equal(result.drifted[0].newSha, sha256(Buffer.from(NEW, "utf8")));
    assert.equal(result.drifted[0].classification, "behavior_changed");
    assert.match(result.summary, /src-quotas \[behavior_changed\]/);
    assert.equal(nextState.seen.length, 2);
    assert.deepEqual(warnings, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discover: unchanged live bytes are not drift, and the run is empty when nothing else applies", async () => {
  const dir = fixture();
  try {
    const { result } = await discover({
      contentDir: dir,
      checkLive: true,
      maxNew: 0,
      minPerObjective: 0,
      fetch: fakeFetch(OLD),
      store: fakeStore,
      warn: () => {},
    });
    assert.deepEqual(result.drifted, []);
    assert.deepEqual(result.gaps, []);
    assert.equal(result.newPages.length, 0);
    assert.equal(result.empty, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("discover: without a store the delta is left unknown with a warning, never guessed", async () => {
  const dir = fixture();
  try {
    const warnings = [];
    const { result } = await discover({
      contentDir: dir,
      checkLive: true,
      fetch: fakeFetch(NEW),
      store: null,
      warn: (m) => warnings.push(m),
    });
    assert.equal(result.drifted[0].classification, "unknown");
    assert.ok(warnings.some((w) => /no R2 credentials/.test(w)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rankPages prefers a path naming a gap objective, then the course's primary host", () => {
  const pages = [
    { url: "https://docs.nebius.com/compute/quotas.md", host: "docs.nebius.com", first_seen: "2026-09-01" },
    {
      url: "https://docs.tokenfactory.nebius.com/a.md",
      host: "docs.tokenfactory.nebius.com",
      first_seen: "2026-09-02",
    },
    {
      url: "https://docs.tokenfactory.nebius.com/embeddings.md",
      host: "docs.tokenfactory.nebius.com",
      first_seen: "2026-09-03",
    },
  ];
  const gaps = [
    {
      course: "agentic-ai-builder",
      kind: "objective",
      objective: "domain-2/embeddings-and-rerank",
      published: 1,
      needed: 3,
    },
  ];
  assert.deepEqual(
    rankPages(pages, gaps).map((p) => p.url),
    [
      "https://docs.tokenfactory.nebius.com/embeddings.md",
      "https://docs.tokenfactory.nebius.com/a.md",
      "https://docs.nebius.com/compute/quotas.md",
    ],
  );
});

test("discover: a record already marked drifted stays in the report when the live fetch fails", async () => {
  const dir = fixture();
  try {
    const src = join(dir, "sources", "src-quotas.yaml");
    writeFileSync(src, readFileSync(src, "utf8").replace("status: current", "status: drifted"));
    const warnings = [];
    const { result } = await discover({
      contentDir: dir,
      fetch: async (url) => {
        if (url.endsWith("llms.txt")) return "";
        throw new Error("HTTP 503");
      },
      store: fakeStore,
      warn: (m) => warnings.push(m),
    });
    assert.equal(result.drifted.length, 1);
    assert.equal(result.drifted[0].id, "src-quotas");
    assert.equal(result.drifted[0].recordedStatus, "drifted");
    assert.equal(result.drifted[0].classification, "unknown");
    assert.ok(warnings.some((w) => /reported as drifted, delta not classified/.test(w)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
