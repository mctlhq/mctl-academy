import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDriftReport,
  isoWeek,
  umbrellaTitle,
  umbrellaBody,
  findExistingIssue,
  syncUmbrellaIssue,
  MAX_BODY_CHARS,
} from "../scripts/drift-intake.mjs";

const REPORT = [
  "ok       src-co-cuda-init-error",
  "DRIFTED  src-co-compute-quotas  3c9dc77bb8c3 -> 70984369ccff  https://docs.nebius.com/compute/resources/quotas-limits.md",
  "ERROR    src-broken  fetch failed",
  "DRIFTED  src-inference-overview  8bfd4850210d -> 9f0c64e301e1  https://docs.tokenfactory.nebius.com/ai-models-inference/overview.md",
  "",
].join("\n");

const NOW = new Date("2026-11-23T06:00:00Z"); // Monday of 2026-W48
const PR = "https://github.com/o/r/pull/12";

/** A `gh` stub: records argv, answers issue/pr listings from fixtures. */
function fakeGh({ issues = [], prs = [{ url: PR }], failList = false } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "list") {
      if (failList) throw new Error("HTTP 502");
      return JSON.stringify(issues);
    }
    if (args[0] === "pr" && args[1] === "list") return JSON.stringify(prs);
    if (args[0] === "issue" && args[1] === "create") return "https://github.com/o/r/issues/99\n";
    return "";
  };
  return { gh, calls };
}

function manyRows(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `src-${i}`,
    oldHash: "aaaaaaaaaaaa",
    newHash: "bbbbbbbbbbbb",
    url: `https://docs.example/page-${i}.md`,
  }));
}

test("isoWeek labels dates by ISO week, including the year boundary", () => {
  assert.equal(isoWeek(NOW), "2026-W48");
  assert.equal(isoWeek(new Date("2027-01-01T00:00:00Z")), "2026-W53");
  assert.equal(isoWeek(new Date("2026-12-28T00:00:00Z")), "2026-W53");
  // Sunday belongs to the week that ends with it.
  assert.equal(isoWeek(new Date("2026-11-22T12:00:00Z")), "2026-W47");
});

test("parseDriftReport keeps only DRIFTED rows, with both hashes and the url", () => {
  const { rows, errors } = parseDriftReport(REPORT);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    {
      id: "src-co-compute-quotas",
      oldHash: "3c9dc77bb8c3",
      newHash: "70984369ccff",
      url: "https://docs.nebius.com/compute/resources/quotas-limits.md",
    },
    {
      id: "src-inference-overview",
      oldHash: "8bfd4850210d",
      newHash: "9f0c64e301e1",
      url: "https://docs.tokenfactory.nebius.com/ai-models-inference/overview.md",
    },
  ]);
});

test("parseDriftReport reports a line it cannot read and keeps the rows around it", () => {
  const { rows, errors } = parseDriftReport(`DRIFTED  src-x  abc  def\n${REPORT}`);
  assert.equal(rows.length, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unparseable DRIFTED line/);
});

test("umbrellaBody lists every source with its url, the marker and the PR link", () => {
  const body = umbrellaBody({ week: "2026-W48", rows: manyRows(3), prUrl: PR });
  assert.ok(body.startsWith("<!-- source-drift-umbrella:2026-W48 -->"));
  assert.match(body, /3 sources/);
  for (let i = 0; i < 3; i += 1) {
    assert.match(body, new RegExp(`\\\`src-${i}\\\` - https://docs\\.example/page-${i}\\.md`));
  }
  assert.match(body, new RegExp(PR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(body, /and \d+ more/);
});

test("umbrellaBody renders gone and moved rows", () => {
  const body = umbrellaBody({
    week: "2026-W48",
    rows: [
      { id: "src-g", oldHash: "a", newHash: "gone", url: "https://x/g" },
      { id: "src-m", oldHash: "a", newHash: "gone", url: "https://x/m", movedTo: "https://x/new" },
    ],
    prUrl: null,
  });
  assert.match(body, /gone \(404\/410/);
  assert.match(body, /moved to https:\/\/x\/new/);
  assert.match(body, /none open/);
});

test("umbrellaBody truncates under the size limit with an explicit 'and N more' line", () => {
  const rows = manyRows(2000);
  const body = umbrellaBody({ week: "2026-W48", rows, prUrl: PR });
  assert.ok(body.length <= MAX_BODY_CHARS, `body is ${body.length} chars`);
  const m = body.match(/\.\.\.and (\d+) more/);
  assert.ok(m, "truncation line present");
  const shown = (body.match(/^- `src-/gm) || []).length;
  assert.equal(shown + Number(m[1]), 2000);
});

test("findExistingIssue matches the exact title, not a substring hit", () => {
  const title = umbrellaTitle("2026-W48");
  const { gh, calls } = fakeGh({
    issues: [
      { number: 5, title: `${title} (copy)` },
      { number: 7, title },
    ],
  });
  assert.equal(findExistingIssue({ repo: "o/r", title, gh }), 7);
  assert.ok(!calls[0].includes("--jq"));
  assert.equal(calls[0][calls[0].indexOf("--limit") + 1], "100");
  // Closed issues count too: a same-week re-run after a manual close must
  // update that issue, not open a duplicate.
  assert.equal(calls[0][calls[0].indexOf("--state") + 1], "all");
});

test("findExistingIssue throws on a failed, malformed or full listing, never null", () => {
  const title = umbrellaTitle("2026-W48");
  assert.throws(() => findExistingIssue({ repo: "o/r", title, gh: fakeGh({ failList: true }).gh }), /502/);
  assert.throws(() => findExistingIssue({ repo: "o/r", title, gh: () => "not json" }), /parse/);
  assert.throws(() => findExistingIssue({ repo: "o/r", title, gh: () => "{}" }), /not an array/);
  const full = Array.from({ length: 100 }, (_, i) => ({ number: i, title: `other ${i}` }));
  assert.throws(() => findExistingIssue({ repo: "o/r", title, gh: () => JSON.stringify(full) }), /limit/);
});

test("syncUmbrellaIssue creates one issue for all rows, then labels it", () => {
  const { rows } = parseDriftReport(REPORT);
  const { gh, calls } = fakeGh();
  const r = syncUmbrellaIssue({ rows, repo: "o/r", labels: ["content:drift"], gh, now: NOW });
  assert.deepEqual(r, {
    action: "created",
    issue: "https://github.com/o/r/issues/99",
    title: "drift: sources changed 2026-W48",
  });
  const creates = calls.filter((c) => c[0] === "issue" && c[1] === "create");
  assert.equal(creates.length, 1);
  const body = creates[0][creates[0].indexOf("--body") + 1];
  assert.match(body, /src-co-compute-quotas/);
  assert.match(body, /src-inference-overview/);
  assert.match(body, new RegExp(PR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(!creates[0].includes("--label"));
  assert.ok(calls.some((c) => c[0] === "issue" && c[1] === "edit" && c.includes("content:drift")));
});

test("syncUmbrellaIssue re-run updates the existing issue body and never creates or comments", () => {
  const { rows } = parseDriftReport(REPORT);
  const title = umbrellaTitle("2026-W48");
  const { gh, calls } = fakeGh({ issues: [{ number: 7, title }] });
  const r = syncUmbrellaIssue({ rows, repo: "o/r", labels: ["content:drift"], gh, now: NOW });
  assert.deepEqual(r, { action: "updated", issue: 7, title });
  assert.equal(calls.filter((c) => c[0] === "issue" && c[1] === "create").length, 0);
  assert.equal(calls.filter((c) => c[0] === "issue" && c[1] === "comment").length, 0);
  const edit = calls.find((c) => c[0] === "issue" && c[1] === "edit" && c.includes("--body"));
  assert.equal(edit[2], "7");
  assert.match(edit[edit.indexOf("--body") + 1], /source-drift-umbrella:2026-W48/);
});

test("syncUmbrellaIssue fails (and creates nothing) when listing issues fails", () => {
  const { rows } = parseDriftReport(REPORT);
  const { gh, calls } = fakeGh({ failList: true });
  assert.throws(() => syncUmbrellaIssue({ rows, repo: "o/r", gh, now: NOW }), /502/);
  assert.equal(calls.filter((c) => c[0] === "issue" && c[1] === "create").length, 0);
});

test("syncUmbrellaIssue opens nothing when no source drifted", () => {
  const { gh, calls } = fakeGh();
  const r = syncUmbrellaIssue({ rows: [], repo: "o/r", gh, now: NOW });
  assert.equal(r.action, "none");
  assert.equal(calls.length, 0);
});
