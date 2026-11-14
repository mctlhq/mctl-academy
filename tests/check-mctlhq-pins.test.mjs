import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTree, pinProblems } from "../scripts/check-mctlhq-pins.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-mctlhq-pins.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("..", import.meta.url));

/** files: relative path -> object (JSON-encoded) or string (written raw). */
function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), "academy-pins-"));
  for (const [path, body] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof body === "string" ? body : JSON.stringify(body));
  }
  return dir;
}

function run(dir) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

test("exact versions pass, including prerelease and build metadata", () => {
  for (const v of ["0.21.0", "1.2.3", "1.0.0-rc.1", "1.0.0+build.7", "10.20.30-alpha.1+x"]) {
    assert.deepEqual(pinProblems({ dependencies: { "@mctlhq/ui": v } }, "p"), [], v);
  }
});

test("ranges, tags and anything but one exact version fail", () => {
  const bad = [
    "^0.21.0",
    "~0.21.0",
    ">=0.21.0",
    "0.21",
    "0.21.x",
    "*",
    "",
    "latest",
    "next",
    "v0.21.0",
    "=0.21.0",
    "0.21.0 || 0.22.0",
    "0.21.0 - 0.22.0",
    "01.2.3",
    "github:mctlhq/mctl-design",
    "file:../mctl-design",
    "workspace:*",
  ];
  for (const v of bad) {
    const problems = pinProblems({ dependencies: { "@mctlhq/ui": v } }, "p");
    assert.equal(problems.length, 1, JSON.stringify(v));
    assert.match(problems[0], /@mctlhq\/ui/);
  }
});

test("a non-string spec fails rather than being skipped", () => {
  for (const v of [null, 21, { version: "0.21.0" }, ["0.21.0"]]) {
    assert.equal(pinProblems({ dependencies: { "@mctlhq/ui": v } }, "p").length, 1);
  }
});

test("every dependency field is checked, other scopes are ignored", () => {
  const pkg = {
    dependencies: { "@mctlhq/a": "^1.0.0", vue: "^3.5.0" },
    devDependencies: { "@mctlhq/b": "~1.0.0", "@mctlhqx/c": "^1.0.0" },
    optionalDependencies: { "@mctlhq/d": "latest" },
    peerDependencies: { "@mctlhq/e": "*" },
  };
  const problems = pinProblems(pkg, "p");
  assert.equal(problems.length, 4);
  for (const name of ["a", "b", "d", "e"]) assert.ok(problems.some((p) => p.includes(`@mctlhq/${name}`)));
});

test("an npm: alias to an @mctlhq package is checked too", () => {
  assert.equal(pinProblems({ dependencies: { ui: "npm:@mctlhq/ui@^0.21.0" } }, "p").length, 1);
  assert.equal(pinProblems({ dependencies: { ui: "npm:@mctlhq/ui" } }, "p").length, 1);
  assert.deepEqual(pinProblems({ dependencies: { ui: "npm:@mctlhq/ui@0.21.0" } }, "p"), []);
});

test("a malformed package.json shape is a problem, not a pass", () => {
  assert.equal(pinProblems(null, "p").length, 1);
  assert.equal(pinProblems([], "p").length, 1);
  assert.equal(pinProblems("x", "p").length, 1);
  assert.equal(pinProblems({ dependencies: ["@mctlhq/ui"] }, "p").length, 1);
  assert.equal(pinProblems({ dependencies: null }, "p").length, 1);
  assert.equal(pinProblems({ devDependencies: "@mctlhq/ui" }, "p").length, 1);
});

test("checkTree walks nested package.json files and skips node_modules", () => {
  const dir = fixture({
    "package.json": { dependencies: { "@mctlhq/ui": "0.21.0" } },
    "client/package.json": { dependencies: { "@mctlhq/ui": "^0.21.0" } },
    "client/node_modules/@mctlhq/ui/package.json": { dependencies: { "@mctlhq/x": "^1.0.0" } },
  });
  try {
    const { files, problems } = checkTree(dir);
    assert.equal(files.length, 2);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^client\/package\.json: dependencies\.@mctlhq\/ui is "\^0\.21\.0"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unparseable package.json fails the CLI (fail closed)", () => {
  const dir = fixture({
    "package.json": { dependencies: {} },
    "client/package.json": '{ "dependencies": { "@mctlhq/ui": "0.21.0" ',
  });
  try {
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /client\/package\.json: cannot read or parse/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a tree without a root package.json fails the CLI", () => {
  const dir = fixture({ "client/package.json": { dependencies: { "@mctlhq/ui": "0.21.0" } } });
  try {
    const r = run(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /root package\.json not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing root directory fails the CLI", () => {
  const r = run(join(tmpdir(), "academy-pins-does-not-exist-" + process.pid));
  assert.equal(r.code, 1);
  assert.match(r.out, /cannot scan/);
});

test("the CLI exits 1 on a range and 0 on exact pins", () => {
  const bad = fixture({ "package.json": { dependencies: { "@mctlhq/ui": "^0.21.0" } } });
  const good = fixture({ "package.json": { dependencies: { "@mctlhq/ui": "0.21.0" } } });
  try {
    assert.equal(run(bad).code, 1);
    const r = run(good);
    assert.equal(r.code, 0, r.out);
  } finally {
    rmSync(bad, { recursive: true, force: true });
    rmSync(good, { recursive: true, force: true });
  }
});

test("this repository's own package.json files are pinned", () => {
  const { files, problems } = checkTree(REPO);
  assert.deepEqual(problems, []);
  assert.ok(files.some((f) => f.endsWith(join("client", "package.json"))));
});
