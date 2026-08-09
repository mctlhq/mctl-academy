#!/usr/bin/env node
/**
 * Nebius Docs Sync & Delta Detector
 *
 * Compares two versions of documentation markdown (e.g. previous snapshot vs. live document)
 * and classifies content deltas into structured change categories:
 *  - `capability_added`: New API endpoint, feature, parameter, or section.
 *  - `behavior_changed`: Altered default, modified behavior, changed constraint or limit.
 *  - `deprecated`: Deprecation warning, removal notice, or legacy tag added.
 *  - `formatting_only`: Typos, markdown formatting, whitespace changes.
 *
 * Usage:
 *   node scripts/detect-docs-delta.mjs --source <source_id> --old <old_file> --new <new_file>
 *   node scripts/detect-docs-delta.mjs --check-all
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR ? resolve(process.env.ACADEMY_CONTENT_DIR) : join(ROOT, "content");

/**
 * Classify a line delta into a specific change category based on keyword heuristics.
 *
 * @param {string[]} addedLines
 * @param {string[]} removedLines
 * @returns {"capability_added" | "behavior_changed" | "deprecated" | "formatting_only"}
 */
export function classifyDelta(addedLines = [], removedLines = []) {
  const addedText = addedLines.join("\n").toLowerCase();
  const removedText = removedLines.join("\n").toLowerCase();

  // Check for deprecation keywords
  if (
    /deprecated|no longer supported|discontinued|legacy|removed|sunset/i.test(addedText) ||
    (/deprecated|no longer supported/i.test(removedText) && !/deprecated/i.test(addedText))
  ) {
    return "deprecated";
  }

  // Check for capability added (new headings, new endpoints, new parameters, new features)
  if (
    /^#{1,6}\s+/m.test(addedLines.join("\n")) ||
    /new|added|supports|support for|endpoint|api|parameter|option|field|introduced/i.test(addedText)
  ) {
    return "capability_added";
  }

  // Check for behavior changed (modified limits, defaults, constraints, timeouts)
  if (
    /default|limit|maximum|minimum|timeout|behavior|changed|updated|instead of|formerly/i.test(addedText) ||
    (addedLines.length > 0 && removedLines.length > 0)
  ) {
    return "behavior_changed";
  }

  if (addedLines.length > 0 && removedLines.length === 0) {
    return "capability_added";
  }

  if (removedLines.length > 0 && addedLines.length === 0) {
    return "behavior_changed";
  }

  return "formatting_only";
}

/**
 * Compare old and new markdown text and produce a structured delta report.
 *
 * @param {object} opts
 * @param {string} opts.oldText
 * @param {string} opts.newText
 * @param {string} [opts.sourceId]
 * @param {string[]} [opts.objectives]
 * @returns {{
 *   sourceId: string,
 *   classification: "capability_added" | "behavior_changed" | "deprecated" | "formatting_only",
 *   addedLines: string[],
 *   removedLines: string[],
 *   objectives: string[],
 *   summary: string
 * }}
 */
export function detectDocsDelta({ oldText = "", newText = "", sourceId = "unknown", objectives = [] }) {
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);

  const oldSet = new Set(oldLines.map((l) => l.trim()));
  const newSet = new Set(newLines.map((l) => l.trim()));

  const addedLines = newLines.filter((l) => l.trim() && !oldSet.has(l.trim()));
  const removedLines = oldLines.filter((l) => l.trim() && !newSet.has(l.trim()));

  const classification = classifyDelta(addedLines, removedLines);

  let summary = `Source ${sourceId}: ${addedLines.length} added lines, ${removedLines.length} removed lines.`;
  if (classification === "deprecated") {
    summary += " Deprecation or feature removal detected.";
  } else if (classification === "capability_added") {
    summary += " New capability or API feature documented.";
  } else if (classification === "behavior_changed") {
    summary += " Behavior, limit, or default value updated.";
  } else {
    summary += " Minor formatting or typo changes.";
  }

  return {
    sourceId,
    classification,
    addedLines,
    removedLines,
    objectives,
    summary,
  };
}

/**
 * Scan all sources in content/sources/ and check against snapshots.
 */
export function analyzeAllSources(contentDir = CONTENT) {
  const sourcesDir = join(contentDir, "sources");
  if (!existsSync(sourcesDir)) return [];

  const sourceFiles = readdirSync(sourcesDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const reports = [];

  for (const f of sourceFiles) {
    const raw = readFileSync(join(sourcesDir, f), "utf8");
    let data;
    try {
      data = parseYaml(raw);
    } catch (err) {
      throw new Error(`Failed to parse source file ${f}: ${err.message}`);
    }

    if (data?.id) {
      reports.push({
        sourceId: data.id,
        url: data.url,
        status: data.status ?? "current",
        objectives: data.objectives ?? [],
      });
    }
  }

  return reports;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--check-all")) {
    try {
      const reports = analyzeAllSources();
      console.log(`Found ${reports.length} recorded source(s).`);
      console.log(JSON.stringify(reports, null, 2));
    } catch (err) {
      console.error(`Error analyzing sources: ${err.message}`);
      process.exit(1);
    }
  } else {
    const sourceIdx = args.indexOf("--source");
    const oldIdx = args.indexOf("--old");
    const newIdx = args.indexOf("--new");

    if (oldIdx !== -1 && oldIdx + 1 < args.length && newIdx !== -1 && newIdx + 1 < args.length) {
      try {
        const oldText = readFileSync(args[oldIdx + 1], "utf8");
        const newText = readFileSync(args[newIdx + 1], "utf8");
        const sourceId = sourceIdx !== -1 && sourceIdx + 1 < args.length ? args[sourceIdx + 1] : "cli-source";
        const delta = detectDocsDelta({ oldText, newText, sourceId });
        console.log(JSON.stringify(delta, null, 2));
      } catch (err) {
        console.error(`Error reading input files: ${err.message}`);
        process.exit(1);
      }
    } else {
      console.error("Error: --old <file> and --new <file> with valid file paths are required.");
      console.error("Usage: node scripts/detect-docs-delta.mjs --source <id> --old <old.md> --new <new.md>");
      console.error("       node scripts/detect-docs-delta.mjs --check-all");
      process.exit(1);
    }
  }
}
