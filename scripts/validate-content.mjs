#!/usr/bin/env node
/**
 * Content lint.
 *
 * Two layers. JSON Schema covers shape: field types, the four-option rule, the
 * 25-word excerpt cap, the status enum. This script covers everything schema
 * cannot express — cross-file references, the course objective map, and the
 * clean-room authorship rule.
 *
 * Deliberately has no network dependency and reads no secrets, so it runs
 * identically on a fork pull request. Verbatim citation verification is a
 * separate step: it needs the private snapshot store, and therefore cannot run
 * on a fork at all. See CONTRIBUTING.md.
 *
 * Exit code 1 on any error. Warnings do not fail the run.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
// The 2020-12 build specifically: the question schema's single-correct-answer
// rule uses minContains/maxContains, which draft-07 (ajv's default export)
// does not implement — it would silently ignore them and pass a four-correct
// question.
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";
import { checkBundleEligibility, UNUSABLE_SOURCE_STATUSES } from "./lib/content-model.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
// Overridable so the test suite can point the linter at fixture trees and
// assert it actually rejects them. Schemas always come from the real tree —
// a test that validated against its own copy of the schema would prove
// nothing about the schema shipped to contributors.
const CONTENT = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(ROOT, "content");
const SCHEMAS = join(ROOT, "content", "schemas");

const errors = [];
const warnings = [];

const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

/**
 * Hosts content may cite. Mirrors the SOURCES.md allowlist.
 *
 * Token Factory first: it documents the product the course is actually about.
 * docs.nebius.com is the infrastructure cloud and is secondary — see SOURCES.md
 * for why that distinction matters.
 */
const ALLOWED_HOSTS = ["docs.tokenfactory.nebius.com", "docs.nebius.com"];

/**
 * Item authors must be agents. CONTENT-POLICY.md separates authorship from
 * approval because the maintainer has seen the real exam; a human name in
 * `authored.by` is that separation collapsing, which is a policy failure
 * rather than a typo. Approval is recorded in `reviewed.by`, where a human
 * name is exactly what belongs.
 */
const AGENT_AUTHOR = /^agent:[a-z0-9][a-z0-9-]*$/;

function loadYamlDir(dir) {
  const path = join(CONTENT, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => {
      const file = `content/${dir}/${f}`;
      try {
        return { file, name: basename(f), data: parseYaml(readFileSync(join(path, f), "utf8")) };
      } catch (e) {
        err(file, `unparseable YAML: ${e.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validators = {};
for (const kind of ["course", "source", "question", "lesson"]) {
  const schema = JSON.parse(readFileSync(join(SCHEMAS, `${kind}.schema.json`), "utf8"));
  validators[kind] = ajv.compile(schema);
}

// ------------------------------------------------------------------ courses

// content/courses/*.yaml is the single source of truth for course metadata:
// ids, titles, domain weights, the objective map and mock composition. There
// is no second catalog — the client's is generated from these files by
// scripts/build-content-bundle.mjs.
const courses = new Map();
const allKnownObjectives = new Set();

{
  const courseFiles = loadYamlDir("courses");
  if (courseFiles.length === 0) {
    err("content/courses", "no course definitions found — every question would be orphaned");
  }
  for (const { file, data } of courseFiles) {
    if (!validators.course(data)) {
      for (const e of validators.course.errors) err(file, `${e.instancePath || "/"} ${e.message}`);
      continue;
    }
    if (courses.has(data.id)) err(file, `duplicate course id ${data.id}`);

    const objectives = new Set();
    let weightSum = 0;
    let mockSum = 0;

    for (const d of data.domains ?? []) {
      weightSum += d.weight ?? 0;
      mockSum += d.mock_questions ?? 0;
      for (const o of d.objectives ?? []) {
        const objFull = `${d.id}/${o.id ?? o}`;
        objectives.add(objFull);
        allKnownObjectives.add(objFull);
      }
    }

    if (weightSum !== 100) {
      err(file, `domain weights sum to ${weightSum}, expected 100`);
    }
    if (mockSum !== data.mock?.question_count) {
      err(file, `mock_questions sum to ${mockSum} but mock.question_count is ${data.mock?.question_count}`);
    }

    courses.set(data.id, { data, objectives });
  }
}

// ----------------------------------------------------------------- sources

const sources = loadYamlDir("sources");
const sourceIds = new Set();
const sourcesById = new Map();

for (const { file, data } of sources) {
  if (!validators.source(data)) {
    for (const e of validators.source.errors) err(file, `${e.instancePath || "/"} ${e.message}`);
    continue;
  }
  if (sourceIds.has(data.id)) err(file, `duplicate source id ${data.id}`);
  sourceIds.add(data.id);
  sourcesById.set(data.id, data);

  const host = new URL(data.url).host;
  if (!ALLOWED_HOSTS.includes(host)) {
    err(file, `host ${host} is not on the SOURCES.md allowlist`);
  }
  if (data.snapshot && data.snapshot.key !== data.sha256) {
    err(file, "snapshot.key must equal sha256 — snapshots are keyed by content hash");
  }
  for (const o of data.objectives ?? []) {
    if (allKnownObjectives.size && !allKnownObjectives.has(o)) {
      err(file, `objective ${o} is not defined in any course map`);
    }
  }
  for (const c of data.coverage ?? []) {
    const course = courses.get(c.course_id);
    if (!course) {
      err(file, `coverage references unknown course ${c.course_id}`);
    } else if (!course.objectives.has(c.objective)) {
      err(file, `coverage objective ${c.objective} is not in course ${c.course_id}`);
    }
  }
}

// ------------------------------------------------------ questions, lessons

function checkEvidence(file, data) {
  for (const ev of data.evidence ?? []) {
    if (!sourceIds.has(ev.source_id)) {
      err(file, `cites unknown source ${ev.source_id}`);
      continue;
    }
    const src = sources.find((s) => s.data.id === ev.source_id).data;
    if (!src.snapshot) {
      if (data.status === "published" || data.status === "review_ready") {
        err(file, `cannot be ${data.status}: source ${ev.source_id} has no snapshot to verify against`);
      }
    }
    // Both terminal source states withdraw everything citing them. drifted:
    // the upstream document changed and the citation is no longer known to
    // hold. deprecated: the document is gone, so it can never be re-verified.
    // Either way a published item is unsafe, and the fix is to mark the item
    // needs_review and re-author it — not to hide it at runtime.
    if (UNUSABLE_SOURCE_STATUSES.has(src.status) && data.status === "published") {
      err(
        file,
        `cannot be published: source ${ev.source_id} is ${src.status} and needs re-verification`,
      );
    }
  }
}

/**
 * The lint half of the build-time evidence gate: a question the repository
 * marks published must also be one the bundle builder would emit. Without
 * this the two could disagree — the lint would pass a state whose only
 * observable effect is that a question silently vanishes from the client.
 */
function checkBundleAgreement(file, data) {
  if (data.status !== "published") return;
  const { eligible, reasons } = checkBundleEligibility(data, sourcesById);
  if (!eligible) {
    err(file, `is published but would be withheld from the client bundle: ${reasons.join("; ")}`);
  }
}

function checkObjective(file, data) {
  if (!data.objective?.startsWith(`${data.domain}/`)) {
    err(file, `objective ${data.objective} does not belong to ${data.domain}`);
  }
  const course = courses.get(data.course_id);
  if (!course) {
    err(file, `references unknown course_id ${data.course_id}`);
  } else if (!course.objectives.has(data.objective)) {
    err(file, `objective ${data.objective} is not defined in course ${data.course_id}`);
  }
}

function checkLifecycle(file, data) {
  if (data.status === "published" && !data.reviewed) {
    err(file, "published without a `reviewed` block — human approval is not optional");
  }
  if (data.authored && !AGENT_AUTHOR.test(data.authored.by)) {
    err(
      file,
      `authored.by "${data.authored.by}" is not an agent identifier (agent:<name>). ` +
        "CONTENT-POLICY.md: items are authored by agents; humans approve in `reviewed`, not `authored`.",
    );
  }
}

const questions = loadYamlDir("questions");
const questionIds = new Set();

for (const { file, data } of questions) {
  if (!validators.question(data)) {
    for (const e of validators.question.errors) err(file, `${e.instancePath || "/"} ${e.message}`);
    continue;
  }
  if (questionIds.has(data.id)) err(file, `duplicate question id ${data.id}`);
  questionIds.add(data.id);

  checkObjective(file, data);
  checkEvidence(file, data);
  checkLifecycle(file, data);
  checkBundleAgreement(file, data);

  // Schema pins the option count and the single correct answer, but cannot
  // compare option contents to each other.
  const ids = data.options.map((o) => o.id);
  if (new Set(ids).size !== 4) err(file, `option ids must be a, b, c, d exactly once — got ${ids.join(", ")}`);

  const texts = data.options.map((o) => o.text.trim().toLowerCase());
  if (new Set(texts).size !== texts.length) {
    err(file, "two options have the same text — a duplicate option makes the item unanswerable");
  }
}

// A course with nothing publishable is legitimate — it is how a course is
// added before its content exists — but it ships to learners as "Coming soon"
// and cannot be selected, which is worth saying out loud rather than leaving
// an author to discover it in the UI.
for (const [courseId] of courses) {
  const publishable = questions.filter(
    ({ data }) => data.course_id === courseId && checkBundleEligibility(data, sourcesById).eligible,
  ).length;
  if (publishable === 0) {
    warn(`content/courses/${courseId}.yaml`, "no publishable questions — course will show as unavailable");
  }
}

// Answer-position bias across the whole bank.
//
// Caught for real: the first 20 authored questions all had the correct answer
// in position a. The application shuffles options at attempt time, so this was
// invisible in the product — but the bank is public, a static course preview
// renders unshuffled, and a corpus with a degenerate pattern is a sign the
// authoring process is not varying distractors on purpose.
//
// Threshold is deliberately loose: with a small bank, real imbalance is
// expected, and this should fire on a systematic pattern rather than on noise.
if (questions.length >= 12) {
  const positions = new Map();
  for (const { data } of questions) {
    const correct = data.options?.find((o) => o.correct);
    if (correct) positions.set(correct.id, (positions.get(correct.id) ?? 0) + 1);
  }
  for (const [id, count] of positions) {
    const share = count / questions.length;
    if (share > 0.5) {
      err(
        "content/questions",
        `${Math.round(share * 100)}% of correct answers are in position "${id}" ` +
          `(${count} of ${questions.length}) — vary the placement`,
      );
    }
  }
}

const lessons = loadYamlDir("lessons");
const lessonIds = new Set();

for (const { file, data } of lessons) {
  if (!validators.lesson(data)) {
    for (const e of validators.lesson.errors) err(file, `${e.instancePath || "/"} ${e.message}`);
    continue;
  }
  if (lessonIds.has(data.id)) err(file, `duplicate lesson id ${data.id}`);
  lessonIds.add(data.id);

  checkObjective(file, data);
  checkEvidence(file, data);
  checkLifecycle(file, data);
}

// ------------------------------------------------------------------ report

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);

const counts = `${sources.length} sources, ${questions.length} questions, ${lessons.length} lessons`;

if (errors.length) {
  console.error(`\nContent lint failed: ${errors.length} error(s) across ${counts}.`);
  process.exit(1);
}
console.log(`Content lint passed: ${counts}${warnings.length ? `, ${warnings.length} warning(s)` : ""}.`);
