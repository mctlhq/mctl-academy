#!/usr/bin/env node
/**
 * Build-time content artefacts for the client.
 *
 * Emits two files, both safe by construction:
 *
 *   client/src/content-bundle.json   every question eligible to be shown to a
 *                                    learner, carrying its canonical course_id
 *   client/src/course-catalog.json   the vendor-neutral course catalog and per
 *                                    -course mock configuration, derived from
 *                                    content/courses/*.yaml
 *
 * Eligibility is scripts/lib/content-model.mjs's rule, not a local
 * reimplementation: published, human-reviewed, every cited source resolvable,
 * snapshotted, and neither drifted nor deprecated. A question that fails any
 * of it never reaches the bundle, so the application never has to re-check
 * evidence state at runtime and no network request stands between a learner
 * and a safe question. Marking a source drifted and rebuilding is the
 * withdrawal mechanism.
 *
 * Deliberately strips fields the client does not need (evidence, authored,
 * reviewed, schema_version) so the bundle carries only what the learning
 * screens render.
 *
 * The catalog exposes only vendor-neutral fields. `prepares_for`, the course
 * description and the disclaimer name a certification vendor and stay in
 * content/ — LEGAL.md forbids them in nav labels, URLs, page titles or images.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCourses, partitionQuestions } from "./lib/content-model.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONTENT = process.env.ACADEMY_CONTENT_DIR ? resolve(process.env.ACADEMY_CONTENT_DIR) : join(ROOT, "content");
const OUT = process.env.ACADEMY_BUNDLE_OUT
  ? resolve(process.env.ACADEMY_BUNDLE_OUT)
  : join(ROOT, "client", "src", "content-bundle.json");
const CATALOG_OUT = process.env.ACADEMY_CATALOG_OUT
  ? resolve(process.env.ACADEMY_CATALOG_OUT)
  : join(ROOT, "client", "src", "course-catalog.json");

const { eligible, excluded, total } = partitionQuestions(CONTENT, (file, msg) =>
  console.warn(`warn  ${file}: ${msg}`),
);

const bundle = eligible.map(({ data: q }) => ({
  id: q.id,
  course_id: q.course_id,
  domain: q.domain,
  objective: q.objective,
  stem: q.stem,
  options: q.options.map((o) => ({
    id: o.id,
    text: o.text,
    correct: o.correct,
    explanation: o.explanation,
  })),
}));

// ---------------------------------------------------------------- catalog

const courses = loadCourses(CONTENT, (file, msg) => console.warn(`warn  ${file}: ${msg}`));

const publishedByCourse = new Map();
for (const q of bundle) {
  publishedByCourse.set(q.course_id, (publishedByCourse.get(q.course_id) ?? 0) + 1);
}

const catalog = [...courses.values()]
  .map((course) => {
    const publishedQuestionCount = publishedByCourse.get(course.id) ?? 0;
    return {
      id: course.id,
      title: course.title,
      publishedQuestionCount,
      // A course with no eligible questions is listed but not selectable. As
      // soon as content lands for it this flips on its own — no TypeScript
      // change, no second catalog to keep in step.
      available: publishedQuestionCount > 0,
      mock: {
        questionCount: course.mock?.question_count ?? 30,
        timeLimitMinutes: course.mock?.time_limit_minutes ?? 60,
        discloseBankSize: course.mock?.disclose_bank_size ?? true,
        domains: (course.domains ?? []).map((d) => ({
          id: d.id,
          title: d.title,
          weight: d.weight,
          mockQuestions: d.mock_questions,
        })),
      },
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

// A question whose course_id names no canonical course would be unreachable in
// the UI (nothing can select it), which is a content bug rather than something
// to silently ship.
for (const [courseId, count] of publishedByCourse) {
  if (!courses.has(courseId)) {
    console.error(`ERROR: ${count} published question(s) reference unknown course_id ${courseId}`);
    process.exit(1);
  }
}

mkdirSync(join(OUT, ".."), { recursive: true });
writeFileSync(OUT, JSON.stringify(bundle, null, 2) + "\n");
mkdirSync(join(CATALOG_OUT, ".."), { recursive: true });
writeFileSync(CATALOG_OUT, JSON.stringify(catalog, null, 2) + "\n");

for (const { file, reasons } of excluded) {
  console.log(`skip  ${file}: ${reasons.join("; ")}`);
}
console.log(
  `Content bundle written to ${OUT} — ${bundle.length}/${total} questions eligible.\n` +
    `Course catalog written to ${CATALOG_OUT} — ` +
    catalog.map((c) => `${c.id}:${c.publishedQuestionCount}`).join(", "),
);
