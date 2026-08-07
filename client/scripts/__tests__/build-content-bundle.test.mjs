import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

// The bundle under test is produced by build-content-bundle.mjs, which runs
// as a pretest step (see client/package.json) before this test executes.
const CLIENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..");
const CONTENT_DIR = join(REPO_ROOT, "content");
const BUNDLE_PATH = join(CLIENT_ROOT, "src", "data", "mock-bundle.generated.json");

function loadQuestionFiles() {
  const dir = join(CONTENT_DIR, "questions");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => parseYaml(readFileSync(join(dir, f), "utf8")));
}

describe("build-content-bundle.mjs output", () => {
  it("includes only status: published questions", () => {
    const all = loadQuestionFiles();
    const publishedIds = new Set(all.filter((q) => q.status === "published").map((q) => q.id));
    const nonPublishedIds = new Set(all.filter((q) => q.status !== "published").map((q) => q.id));

    const bundle = JSON.parse(readFileSync(BUNDLE_PATH, "utf8"));
    const bundleIds = bundle.questions.map((q) => q.id);

    expect(bundleIds.length).toBe(publishedIds.size);
    for (const id of bundleIds) {
      expect(publishedIds.has(id)).toBe(true);
      expect(nonPublishedIds.has(id)).toBe(false);
    }
  });

  it("carries the mock config from content/branding.yaml", () => {
    const branding = parseYaml(readFileSync(join(CONTENT_DIR, "branding.yaml"), "utf8"));
    const bundle = JSON.parse(readFileSync(BUNDLE_PATH, "utf8"));
    expect(bundle.mock.questionCount).toBe(branding.mock.question_count);
    expect(bundle.mock.timeLimitMinutes).toBe(branding.mock.time_limit_minutes);
    expect(bundle.mock.discloseBankSize).toBe(branding.mock.disclose_bank_size);
    expect(bundle.mock.domains.map((d) => d.mockQuestions)).toEqual(
      branding.domains.map((d) => d.mock_questions),
    );
  });
});

describe("generated bundle output path", () => {
  it("is excluded from version control by the root .gitignore", () => {
    const gitignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/client\/src\/data\/\*\.generated\.json/);
  });
});
