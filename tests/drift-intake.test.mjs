import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDriftReport,
  issueTitle,
  issueBody,
  findExistingIssue,
  syncDriftIssues,
} from "../scripts/drift-intake.mjs";

const REPORT = [
  "ok       src-co-cuda-init-error",
  "DRIFTED  src-co-compute-quotas  3c9dc77bb8c3 -> 70984369ccff  https://docs.nebius.com/compute/resources/quotas-limits.md",
  "ERROR    src-broken  fetch failed",
  "DRIFTED  src-inference-overview  8bfd4850210d -> 9f0c64e301e1  https://docs.tokenfactory.nebius.com/ai-models-inference/overview.md",
  "",
].join("\n");

/** A `gh` stub that records argv and answers `issue list` from a fixture. */
function fakeGh(openIssues) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "list") return JSON.stringify(openIssues);
    if (args[0] === "issue" && args[1] === "create") return "https://github.com/o/r/issues/99\n";
    return "";
  };
  return { gh, calls };
}

test("parseDriftReport keeps only DRIFTED rows, with both hashes and the url", () => {
  const rows = parseDriftReport(REPORT);
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

test("parseDriftReport rejects a DRIFTED line it cannot read rather than guessing", () => {
  assert.throws(() => parseDriftReport("DRIFTED  src-x  abc  def"), /unparseable DRIFTED line/);
});

test("findExistingIssue matches the exact title, not a substring hit", () => {
  const { gh, calls } = fakeGh([
    { number: 5, title: "drift: src-co-compute-quotas-legacy" },
    { number: 7, title: "drift: src-co-compute-quotas" },
  ]);
  const n = findExistingIssue({ repo: "o/r", title: issueTitle("src-co-compute-quotas"), gh });
  assert.equal(n, 7);
  // The old inline loop died here: `--jq --arg` is not a gh flag.
  assert.ok(!calls[0].includes("--jq"));
  assert.ok(!calls[0].includes("--arg"));
  assert.ok(calls[0].includes('"drift: src-co-compute-quotas" in:title'));
});

test("findExistingIssue returns null when only a substring match exists", () => {
  const { gh } = fakeGh([{ number: 5, title: "drift: src-co-compute-quotas-legacy" }]);
  assert.equal(findExistingIssue({ repo: "o/r", title: issueTitle("src-co-compute-quotas"), gh }), null);
});

test("syncDriftIssues comments on an open issue and creates one otherwise", () => {
  const rows = parseDriftReport(REPORT);
  const { gh, calls } = fakeGh([{ number: 7, title: "drift: src-co-compute-quotas" }]);
  const actions = syncDriftIssues({ rows, repo: "o/r", labels: ["content:drift"], gh });

  assert.deepEqual(actions, [
    { id: "src-co-compute-quotas", action: "commented", issue: 7 },
    { id: "src-inference-overview", action: "created", issue: "https://github.com/o/r/issues/99" },
  ]);

  const comment = calls.find((c) => c[0] === "issue" && c[1] === "comment");
  assert.equal(comment[2], "7");
  assert.match(comment[comment.indexOf("--body") + 1], /3c9dc77bb8c3/);

  const create = calls.find((c) => c[0] === "issue" && c[1] === "create");
  assert.equal(create[create.indexOf("--title") + 1], "drift: src-inference-overview");
  assert.match(create[create.indexOf("--body") + 1], /9f0c64e301e1/);
  // Labels go on after creation, so a missing label can never block the issue.
  assert.ok(!create.includes("--label"));
  const edit = calls.find((c) => c[0] === "issue" && c[1] === "edit");
  assert.deepEqual(edit.slice(2), [
    "https://github.com/o/r/issues/99",
    "--repo",
    "o/r",
    "--add-label",
    "content:drift",
  ]);
});

test("syncDriftIssues keeps going after one row's gh failure and reports it", () => {
  const rows = parseDriftReport(REPORT);
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "list") return "[]";
    if (args[0] === "issue" && args[1] === "create") {
      if (args[args.indexOf("--title") + 1] === "drift: src-co-compute-quotas")
        throw new Error("HTTP 403 secondary rate limit");
      return "https://github.com/o/r/issues/100\n";
    }
    if (args[0] === "issue" && args[1] === "edit") throw new Error("label not found");
    return "";
  };
  const actions = syncDriftIssues({ rows, repo: "o/r", labels: ["content:drift"], gh });
  assert.deepEqual(actions, [
    { id: "src-co-compute-quotas", action: "failed", issue: "" },
    { id: "src-inference-overview", action: "created", issue: "https://github.com/o/r/issues/100" },
  ]);
  // The second issue was still created even though its label could not be added.
  assert.equal(calls.filter((c) => c[0] === "issue" && c[1] === "create").length, 2);
});

test("findExistingIssue asks for a full page so the exact match cannot fall off it", () => {
  const { gh, calls } = fakeGh([]);
  findExistingIssue({ repo: "o/r", title: "drift: src-x", gh });
  assert.equal(calls[0][calls[0].indexOf("--limit") + 1], "100");
});

test("issueBody carries the recapture command and the quarantine branch", () => {
  const body = issueBody(parseDriftReport(REPORT)[0]);
  assert.match(
    body,
    /npm run snapshot:capture -- https:\/\/docs\.nebius\.com\/compute\/resources\/quotas-limits\.md --id src-co-compute-quotas/,
  );
  assert.match(body, /chore\/quarantine-drift/);
});
