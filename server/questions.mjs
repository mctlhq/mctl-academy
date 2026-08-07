import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/**
 * Known question ids, used to validate POST /api/reports' question_id
 * (issue #22).
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

function loadQuestionIds() {
  if (!existsSync(QUESTIONS_DIR)) {
    console.warn(`[questions] ${QUESTIONS_DIR} not found -- question_id validation disabled.`);
    return null;
  }

  const ids = new Set();
  for (const file of readdirSync(QUESTIONS_DIR)) {
    if (!file.endsWith(".yaml")) continue;
    const doc = parseYaml(readFileSync(join(QUESTIONS_DIR, file), "utf8"));
    if (doc && typeof doc.id === "string") ids.add(doc.id);
  }
  return ids;
}

const knownQuestionIds = loadQuestionIds();

/**
 * True when content/ was unavailable at startup (validation disabled -- fail
 * open rather than 404 every report) or when id is a known question id.
 * False only when content/ was read successfully and id is not in it -- the
 * case that should produce a 404 from POST /api/reports.
 */
export function isKnownQuestionId(id) {
  if (knownQuestionIds === null) return true;
  return knownQuestionIds.has(id);
}
