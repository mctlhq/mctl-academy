import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/**
 * Known question ids and their answer key, used to validate POST
 * /api/reports' question_id (issue #22) and to grade POST /api/attempts
 * (issue #208).
 *
 * Reads content/questions/*.yaml directly, the same read pattern
 * scripts/build-preview.mjs and scripts/build-content-bundle.mjs already
 * use. Unlike the client's build-time content-bundle.json (published
 * questions only, baked into the static client bundle), a report must be
 * acceptable against any known question id regardless of status -- a
 * needs_review item withdrawn from selection after source drift can still
 * legitimately receive a report referencing a past attempt (see
 * requirements.md's "Open questions" for issue #22).
 *
 * Loaded once at process start. content/ only changes via a content PR
 * merge and a redeploy -- there is no publish pipeline to update this
 * live -- so a snapshot loaded at start is an accepted limitation.
 */

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = process.env.ACADEMY_CONTENT_DIR
  ? resolve(process.env.ACADEMY_CONTENT_DIR)
  : join(SERVER_DIR, "..", "content");
const QUESTIONS_DIR = join(CONTENT_DIR, "questions");

/**
 * The answer key, keyed by question id: { domain, correctOptionId, optionIds }.
 * POST /api/attempts grades a learner's selection against it (issue #208) --
 * the server, not the client, decides whether an attempt was correct. Status
 * is deliberately not consulted: grading is a lookup of the published answer
 * key, not a re-evaluation of evidence state (CLAUDE.md, "The gate"), and a
 * past attempt on a since-withdrawn item must still be gradable on backfill.
 */
function loadAnswerKey() {
  if (!existsSync(QUESTIONS_DIR)) {
    console.warn(
      `[questions] ${QUESTIONS_DIR} not found -- question_id validation disabled, attempts cannot be graded.`,
    );
    return null;
  }

  const key = new Map();
  for (const file of readdirSync(QUESTIONS_DIR)) {
    if (!file.endsWith(".yaml")) continue;
    const doc = parseYaml(readFileSync(join(QUESTIONS_DIR, file), "utf8"));
    if (!doc || typeof doc.id !== "string") continue;
    const options = Array.isArray(doc.options) ? doc.options : [];
    const correct = options.filter((o) => o && o.correct === true);
    key.set(doc.id, {
      domain: typeof doc.domain === "string" ? doc.domain : null,
      // Exactly one correct option is a schema invariant; anything else is
      // treated as ungradable rather than guessed at.
      correctOptionId: correct.length === 1 && typeof correct[0].id === "string" ? correct[0].id : null,
      optionIds: new Set(options.map((o) => o && o.id).filter((id) => typeof id === "string")),
    });
  }
  return key;
}

const answerKey = loadAnswerKey();

/**
 * True when content/ was unavailable at startup (validation disabled -- fail
 * open rather than 404 every report) or when id is a known question id.
 * False only when content/ was read successfully and id is not in it -- the
 * case that should produce a 404 from POST /api/reports.
 */
export function isKnownQuestionId(id) {
  if (answerKey === null) return true;
  return answerKey.has(id);
}

/**
 * Grades one attempt. `optionId` is the stable option id the learner chose
 * ("a".."d", never a rendered position -- options are shuffled per session),
 * or null for a Mock exam question left unanswered, which is incorrect.
 *
 * Returns one of:
 *   { ok: true, domain, correct }
 *   { ok: false, reason: "unavailable" }      content/ was not loaded, or the
 *                                              question has no usable key --
 *                                              the attempt cannot be graded
 *   { ok: false, reason: "unknown_question" }
 *   { ok: false, reason: "unknown_option" }
 *
 * Unlike isKnownQuestionId this never fails open: an attempt that cannot be
 * graded is refused, never stored with a guessed result.
 */
export function gradeAttempt(questionId, optionId) {
  if (answerKey === null) return { ok: false, reason: "unavailable" };
  const entry = answerKey.get(questionId);
  if (!entry) return { ok: false, reason: "unknown_question" };
  if (entry.correctOptionId === null || entry.domain === null) return { ok: false, reason: "unavailable" };
  if (optionId === null) return { ok: true, domain: entry.domain, correct: false };
  if (!entry.optionIds.has(optionId)) return { ok: false, reason: "unknown_option" };
  return { ok: true, domain: entry.domain, correct: optionId === entry.correctOptionId };
}
