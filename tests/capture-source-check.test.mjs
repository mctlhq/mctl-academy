import { test } from "node:test";
import assert from "node:assert/strict";

import { checkSources, GONE_STATUSES } from "../scripts/capture-source.mjs";
import { sha256 } from "../scripts/lib/snapshot-store.mjs";
import { parseDriftReport, issueBody } from "../scripts/drift-intake.mjs";

const SAME = "same bytes";
const httpError = (status) => Object.assign(new Error(`fetch: HTTP ${status}`), { httpStatus: status });

function source(id, overrides = {}) {
  return {
    path: `content/sources/${id}.yaml`,
    data: {
      id,
      url: `https://docs.example/${id}.md`,
      sha256: sha256(Buffer.from(SAME, "utf8")),
      status: "current",
      ...overrides,
    },
  };
}

/** Runs checkSources over `responses` (id -> text | Error). */
async function run(responses, { markDrifted = true, statuses = {} } = {}) {
  const sources = Object.keys(responses).map((id) =>
    source(id, statuses[id] ? { status: statuses[id] } : {}),
  );
  const writes = new Map();
  const lines = [];
  const code = await checkSources({
    sources,
    markDrifted,
    fetcher: async (url) => {
      const r = responses[url.replace("https://docs.example/", "").replace(".md", "")];
      if (r instanceof Error) throw r;
      return r;
    },
    write: (path, data) => writes.set(path, { ...data }),
    log: (l) => lines.push(l),
    logError: (l) => lines.push(l),
  });
  return { code, writes, report: lines.join("\n") };
}

test("404 and 410 are the only statuses read as gone", () => {
  assert.deepEqual([...GONE_STATUSES].sort(), [404, 410]);
});

test("a page the host reports gone is deprecated and reported, not a failed read", async () => {
  for (const status of [404, 410]) {
    const { code, writes, report } = await run({ a: SAME, b: httpError(status) });
    assert.equal(code, 2, `HTTP ${status} is a finding`);
    assert.equal(writes.get("content/sources/b.yaml")?.status, "deprecated");
    assert.equal(writes.has("content/sources/a.yaml"), false);
    const { rows, errors } = parseDriftReport(report);
    assert.deepEqual(errors, []);
    assert.deepEqual(
      rows.map((r) => [r.id, r.newHash]),
      [["b", "gone"]],
    );
  }
});

test("any other failed read still fails the run: could not observe is not absent", async () => {
  for (const err of [httpError(403), httpError(500), httpError(429), new Error("timed out")]) {
    const { code, writes } = await run({ a: SAME, b: err });
    assert.equal(code, 3);
    assert.equal(writes.has("content/sources/b.yaml"), false, "an unread source must not be marked");
  }
});

test("one unreadable source does not keep observed drift unmarked", async () => {
  const { code, writes } = await run({ a: "changed bytes", b: httpError(503), c: httpError(404) });
  assert.equal(code, 3, "an unreadable source is reported, never read as clean");
  assert.equal(writes.get("content/sources/a.yaml")?.status, "drifted");
  assert.equal(writes.get("content/sources/c.yaml")?.status, "deprecated");
});

test("without --mark-drifted nothing is written", async () => {
  const { code, writes } = await run({ a: "changed", b: httpError(404) }, { markDrifted: false });
  assert.equal(code, 2);
  assert.equal(writes.size, 0);
});

test("a clean check exits 0", async () => {
  assert.equal((await run({ a: SAME })).code, 0);
});

test("the issue for a gone page says deprecated and does not offer a recapture of the dead URL", () => {
  const body = issueBody({ id: "b", url: "https://docs.example/b.md", oldHash: "abc", newHash: "gone" });
  assert.match(body, /status: deprecated/);
  assert.doesNotMatch(body, /snapshot:capture/);
});

test("Source drift still quarantines observed drift when a source could not be read", async () => {
  const { readFileSync, mkdtempSync, writeFileSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { parse } = await import("yaml");
  const wf = parse(readFileSync(new URL("../.github/workflows/source-drift.yml", import.meta.url), "utf8"));
  const steps = wf.jobs.drift.steps;
  const check = steps.find((s) => s.id === "check");
  const branch = /case "\$code" in[\s\S]*?\n\s*esac/.exec(check.run);
  assert.ok(branch, "the exit code is not read as a set of codes");

  const outcome = (code, report) => {
    const dir = mkdtempSync(join(tmpdir(), "drift-case-"));
    writeFileSync(join(dir, "drift.txt"), report);
    writeFileSync(join(dir, "out"), "");
    let status = 0;
    try {
      execFileSync("bash", ["-c", `set -euo pipefail\ncode=${code}\n${branch[0]}`], {
        cwd: dir,
        env: { ...process.env, GITHUB_OUTPUT: join(dir, "out") },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      status = err.status;
    }
    const out = Object.fromEntries(
      readFileSync(join(dir, "out"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => l.split("=")),
    );
    return { status, out };
  };
  const row = "DRIFTED  src-a  aaaaaaaaaaaa -> bbbbbbbbbbbb  https://docs.example/a.md\n";
  assert.deepEqual(outcome(3, row), { status: 0, out: { unreachable: "true", drifted: "true" } });
  assert.deepEqual(outcome(3, "ERROR    src-b: HTTP 503\n"), {
    status: 0,
    out: { unreachable: "true", drifted: "false" },
  });
  assert.deepEqual(outcome(2, row), { status: 0, out: { drifted: "true" } });
  assert.deepEqual(outcome(0, ""), { status: 0, out: { drifted: "false" } });
  for (const code of [1, 137, 127]) assert.equal(outcome(code, row).status, 1, `exit ${code} must fail`);

  const last = steps.at(-1);
  assert.match(last.if, /steps\.check\.outputs\.unreachable == 'true'/);
  assert.match(last.if, /!cancelled\(\)/);
  assert.match(last.run, /exit 1/);
  assert.equal(last["continue-on-error"], undefined, "the red step must be able to turn the run red");
  const quarantine = steps.findIndex((s) => /quarantine-drifted-questions/.test(s.run ?? ""));
  assert.ok(quarantine > 0 && quarantine < steps.length - 1, "the red step must come after the quarantine");
});

test("a deprecated source is skipped: neither gone nor changed bytes is a new finding", async () => {
  const fetched = [];
  const sources = [source("a"), source("b", { status: "deprecated" })];
  const writes = new Map();
  const code = await checkSources({
    sources,
    markDrifted: true,
    fetcher: async (url) => {
      fetched.push(url);
      throw httpError(404);
    },
    write: (path, data) => writes.set(path, { ...data }),
    log: () => {},
    logError: () => {},
  });
  assert.equal(code, 2, "only the newly gone source is a finding");
  assert.deepEqual(fetched, ["https://docs.example/a.md"]);
  assert.equal(writes.has("content/sources/b.yaml"), false, "deprecated is never overwritten");
  const again = await run({ b: "changed bytes" }, { statuses: { b: "deprecated" } });
  assert.equal(again.code, 0, "a deprecated source alone leaves the check clean");
  assert.equal(again.writes.size, 0);
});

test("the issue for a gone page says the status is restored by hand", () => {
  const body = issueBody({ id: "b", url: "https://docs.example/b.md", oldHash: "abc", newHash: "gone" });
  assert.match(body, /by hand/);
});
