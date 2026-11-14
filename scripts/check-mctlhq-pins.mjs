#!/usr/bin/env node
/**
 * Fails when any `@mctlhq/*` dependency in any package.json of this repo is
 * not pinned to an exact semver version (#210).
 *
 * `@mctlhq/ui` is the design system, released from mctlhq/mctl-design on its
 * own schedule. With a range such as `^0.21.0`, a fresh install (or a lockfile
 * regenerated for an unrelated reason) can pull a new design-system release
 * into this app without a commit here that says so. An exact pin makes every
 * design-system upgrade a reviewed change to package.json.
 *
 * Same shape as mctl-design's `check:versions`: a plain script that walks the
 * package.json files, collects every problem, prints them all and exits 1.
 *
 * Fail closed: a package.json that cannot be read or parsed, or a dependency
 * map that is not an object, is reported as a problem, never skipped.
 *
 * Usage: node scripts/check-mctlhq-pins.mjs [root]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Official semver 2.0.0 grammar (semver.org), with no `v`/`=` prefix and no
// range operators: exactly one version, nothing else.
export const EXACT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

const SCOPE = "@mctlhq/";
const ALIAS = "npm:@mctlhq/";
// Directories that never hold a package.json of this repo's own.
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"]);

/**
 * Problems in one parsed package.json. `where` labels the messages.
 * @param {unknown} pkg
 * @param {string} where
 * @returns {string[]}
 */
export function pinProblems(pkg, where) {
  if (pkg === null || typeof pkg !== "object" || Array.isArray(pkg)) {
    return [`${where}: not a JSON object`];
  }
  const problems = [];
  for (const field of DEPENDENCY_FIELDS) {
    if (!(field in pkg)) continue;
    const deps = pkg[field];
    if (deps === null || typeof deps !== "object" || Array.isArray(deps)) {
      problems.push(`${where}: "${field}" is not an object`);
      continue;
    }
    for (const [name, spec] of Object.entries(deps)) {
      let version = spec;
      let label = name;
      if (typeof spec === "string" && spec.startsWith(ALIAS)) {
        // "alias": "npm:@mctlhq/ui@0.21.0" -- the version is after the last @.
        const at = spec.lastIndexOf("@");
        version = at > ALIAS.length ? spec.slice(at + 1) : "";
        label = `${name} (${spec})`;
      } else if (!name.startsWith(SCOPE)) {
        continue;
      }
      if (typeof version !== "string" || !EXACT_SEMVER.test(version)) {
        problems.push(
          `${where}: ${field}.${label} is ${JSON.stringify(spec)}, expected an exact version such as "1.2.3"`,
        );
      }
    }
  }
  return problems;
}

/**
 * Every package.json under `root`, skipping dependency, build and dot dirs.
 * A directory that cannot be listed throws: an unreadable tree is not a
 * tree with no package.json in it.
 * @param {string} root
 * @returns {string[]}
 */
export function findPackageJsons(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.name === "package.json") {
        found.push(join(dir, entry.name));
      }
    }
  };
  walk(root);
  return found.sort();
}

/**
 * @param {string} root
 * @returns {{ files: string[], problems: string[] }}
 */
export function checkTree(root) {
  const files = findPackageJsons(root);
  const problems = [];
  if (!files.includes(join(root, "package.json"))) {
    problems.push(`${join(root, "package.json")}: root package.json not found`);
  }
  for (const file of files) {
    const where = relative(root, file) || file;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      problems.push(`${where}: cannot read or parse: ${err.message}`);
      continue;
    }
    problems.push(...pinProblems(pkg, where));
  }
  return { files, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? ROOT;
  let result;
  try {
    result = checkTree(root);
  } catch (err) {
    console.error(`check-mctlhq-pins: cannot scan ${root}: ${err.message}`);
    process.exit(1);
  }
  if (result.problems.length > 0) {
    console.error(
      `@mctlhq dependencies must be pinned to an exact version:\n  ${result.problems.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.log(
    `check-mctlhq-pins: every @mctlhq dependency is exact (${result.files.length} package.json files).`,
  );
}
