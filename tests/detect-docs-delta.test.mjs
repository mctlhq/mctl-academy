import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDocsDelta, classifyDelta } from "../scripts/detect-docs-delta.mjs";

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

test("classifyDelta classifies formatting_only for identical text", () => {
  const classification = classifyDelta([], []);
  assert.equal(classification, "formatting_only");
});
