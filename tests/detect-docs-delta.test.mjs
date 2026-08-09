import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectDocsDelta, classifyDelta, analyzeAllSources } from "../scripts/detect-docs-delta.mjs";

test("detectDocsDelta classifies capability_added when new section is added", () => {
  const oldText = "# Function Calling\nExisting content";
  const newText = "# Function Calling\nExisting content\n## New Endpoint\nadded new parameter";
  const delta = detectDocsDelta({ oldText, newText, sourceId: "src-func" });

  assert.equal(delta.classification, "capability_added");
  assert.equal(delta.addedLines.length, 2);
});

test("detectDocsDelta classifies deprecated when deprecation notice is present", () => {
  const oldText = "# API v1\nActive support.";
  const newText = "# API v1\nDeprecated: API v1 is legacy and no longer supported.";
  const delta = detectDocsDelta({ oldText, newText, sourceId: "src-apiv1" });

  assert.equal(delta.classification, "deprecated");
});

test("detectDocsDelta classifies behavior_changed when defaults or limits change", () => {
  const oldText = "Default timeout is 30 seconds.";
  const newText = "Default timeout is 60 seconds maximum.";
  const delta = detectDocsDelta({ oldText, newText, sourceId: "src-timeout" });

  assert.equal(delta.classification, "behavior_changed");
});

test("detectDocsDelta classifies removed lines with zero additions as behavior_changed", () => {
  const classification = classifyDelta([], ["Removed documentation line"]);
  assert.equal(classification, "behavior_changed");
});

test("classifyDelta classifies formatting_only for identical text", () => {
  const classification = classifyDelta([], []);
  assert.equal(classification, "formatting_only");
});

test("analyzeAllSources scans sources directory and handles malformed YAML fail-closed", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "academy-sources-test-"));
  const sourcesDir = join(tempDir, "sources");

  try {
    const reports = analyzeAllSources();
    assert.ok(Array.isArray(reports));

    mkdirSync(sourcesDir, { recursive: true });
    writeFileSync(join(sourcesDir, "bad.yaml"), "invalid: : yaml:");
    assert.throws(() => analyzeAllSources(tempDir), /Failed to parse source file/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
