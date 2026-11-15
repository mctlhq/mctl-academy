import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check, embeddedBunVersion, workflowPins } from "../scripts/check-action-bun-pin.mjs";

const SHA_A = "c0949c50a78c1ec8ce2647db36629b870e715d0c";
const SHA_B = "6c690188da61cf16ee7debb28383ba67f02abb4c";

const workflow = (bun, shas) => `
jobs:
  author:
    steps:
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: ${bun}
${shas.map((s) => `      - uses: anthropics/claude-code-action@${s} # v1 (CLI x, bun y)`).join("\n")}
`;

const actionYml = (bun) => `
runs:
  using: composite
  steps:
    - name: Install Bun
      id: setup-bun
      if: inputs.path_to_bun_executable == ''
      uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
      with:
        bun-version: ${bun}
        token: \${{ github.token }}
    - name: Other
      shell: bash
      run: echo bun-version: 9.9.9
`;

test("reads the bun version from the action's own setup-bun step only", () => {
  assert.equal(embeddedBunVersion(actionYml("1.4.4")), "1.4.4");
  // A bun-version mention outside the setup-bun step does not count.
  assert.equal(embeddedBunVersion("steps:\n  - run: echo\n    with:\n      bun-version: 1.0.0\n"), null);
});

test("passes when the workflow pin equals the bun the pinned action installs", async () => {
  const problems = await check(workflow("1.4.4", [SHA_A, SHA_A]), async () => actionYml("1.4.4"));
  assert.deepEqual(problems, []);
});

test("fails a one-sided action bump: the #434 shape", async () => {
  const problems = await check(workflow("1.3.14", [SHA_A]), async () => actionYml("1.4.4"));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /setup-bun installs 1\.3\.14 but .* installs bun 1\.4\.4/);
});

test("checks every distinct action SHA, not only the first", async () => {
  const yml = { [SHA_A]: actionYml("1.4.4"), [SHA_B]: actionYml("1.3.14") };
  const problems = await check(workflow("1.4.4", [SHA_A, SHA_B]), async (sha) => yml[sha]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /6c69018/);
});

test("fails closed when action.yml cannot be read or has no setup-bun step", async () => {
  const unreadable = await check(workflow("1.4.4", [SHA_A]), async () => {
    throw new Error("HTTP 503");
  });
  assert.match(unreadable[0], /could not read .*HTTP 503/);
  const empty = await check(workflow("1.4.4", [SHA_A]), async () => "runs:\n  steps: []\n");
  assert.match(empty[0], /has no oven-sh\/setup-bun step/);
});

test("fails when the workflow has no pins, disagreeing pins or a non-SHA ref", async () => {
  const yml = async () => actionYml("1.4.4");
  assert.ok((await check("jobs: {}\n", yml)).length >= 2);
  const split = workflow("1.4.4", [SHA_A]) + "          bun-version: 1.3.14\n";
  assert.ok((await check(split, yml)).some((p) => /disagree/.test(p)));
  assert.ok((await check(workflow("1.4.4", ["v1"]), yml)).some((p) => /not a full commit SHA/.test(p)));
});

test("the real workflow pins one bun version and full action SHAs", () => {
  const text = readFileSync(new URL("../.github/workflows/content-replenish.yml", import.meta.url), "utf8");
  const { bun, shas } = workflowPins(text);
  assert.equal(new Set(bun).size, 1);
  assert.ok(shas.length >= 1 && shas.every((s) => /^[0-9a-f]{40}$/.test(s)));
});
