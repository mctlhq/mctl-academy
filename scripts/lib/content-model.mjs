/**
 * Shared, dependency-free read model over content/.
 *
 * One definition of "may this question be shown to a learner", used by both
 * halves of the gate:
 *
 *   1. scripts/validate-content.mjs — rejects a repository state that claims a
 *      question is published while its evidence says otherwise.
 *   2. scripts/build-content-bundle.mjs — refuses to emit such a question into
 *      the client bundle even if the lint were somehow bypassed.
 *
 * That duplication is deliberate (defense in depth), but the *rule* is not
 * duplicated: both import isEligibleForBundle from here. Learner safety is
 * therefore a build-time property of client/src/content-bundle.json, and no
 * application code re-evaluates evidence state at runtime.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { reviewProblems } from "./question-review.mjs";

/** Source states that permanently disqualify anything citing them. */
export const UNUSABLE_SOURCE_STATUSES = new Set(["drifted", "deprecated"]);

/**
 * Documentation content may cite, as a host plus a path prefix. Mirrors the
 * SOURCES.md allowlist; the lint, the capture and discovery scripts and the
 * generated-artefact contract all read it from here so they cannot drift. The
 * prefix keeps a shared host such as huggingface.co to the one documentation
 * tree whose retention terms were reviewed. An entry with a `pathPattern`
 * must also match it in full: the nebius-physical-ai repository is read only
 * at a pinned commit and only from its guide and cookbook pages, because the
 * same tree also holds run evidence, dated results and internal plans.
 */
export const ALLOWED_SOURCES = [
  { host: "docs.tokenfactory.nebius.com", pathPrefix: "/" },
  { host: "docs.nebius.com", pathPrefix: "/" },
  { host: "huggingface.co", pathPrefix: "/docs/lerobot/" },
  {
    host: "docs.tavily.com",
    pathPrefix: "/",
    // The API, SDK, best-practice and example pages only. Third-party
    // integration and partnership pages, machine payments and the changelog
    // are outside the reviewed scope (SOURCES.md).
    pathPattern:
      /^\/((agents|index)\.md|faq\/[a-z0-9-]+\.md|documentation\/(?!(integrations|partnerships|machine-payments)(\/|\.md$))[a-z0-9-]+(\/[a-z0-9-]+)*\.md|sdk\/(python|javascript)\/[a-z0-9-]+\.md|examples\/[a-z0-9-]+(\/[a-z0-9-]+)*\.md)$/,
  },
  {
    host: "raw.githubusercontent.com",
    pathPrefix: "/nebius/nebius-physical-ai/",
    pathPattern:
      /^\/nebius\/nebius-physical-ai\/[0-9a-f]{40}\/docs\/(quickstart\.md|workbench\/(guides|cookbooks)\/[a-z0-9-]+\.md|workbench\/composing-cloud-and-token-factory\.md)$/,
    // GitHub serves every commit in a fork network under the parent's path,
    // so a SHA in the URL does not show the parent published it. Capture
    // checks the commit is on this branch of this repository.
    pinned: { repo: "nebius/nebius-physical-ai", branch: "main" },
  },
];

/**
 * Whether a URL is inside the allowlist: HTTPS, no credentials or explicit
 * port, and under an allowlisted prefix. The WHATWG parser has already
 * resolved `..` and `%2e%2e` segments, so a prefix match cannot be escaped.
 */
export function isAllowedSourceUrl(value) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  return ALLOWED_SOURCES.some(
    (s) =>
      url.hostname === s.host &&
      url.pathname.startsWith(s.pathPrefix) &&
      (!s.pathPattern || s.pathPattern.test(url.pathname)),
  );
}

/**
 * The repository commit an allowlisted URL is pinned to, or null for an
 * entry that is not commit-pinned. The SHA is the path segment right after
 * the repository, which `pathPattern` has already constrained to 40 hex.
 */
export function pinnedCommitOf(value) {
  if (!isAllowedSourceUrl(value)) return null;
  const url = value instanceof URL ? value : new URL(value);
  const entry = ALLOWED_SOURCES.find(
    (s) => s.pinned && url.hostname === s.host && url.pathname.startsWith(s.pathPrefix),
  );
  if (!entry) return null;
  const sha = url.pathname.slice(entry.pathPrefix.length).split("/")[0];
  return { repo: entry.pinned.repo, branch: entry.pinned.branch, sha };
}

/**
 * Where independent review receipts live, relative to a content directory:
 * docs/content/*-review.json beside the real tree, overridable for fixtures.
 */
export function defaultReviewDir(contentDir) {
  return process.env.ACADEMY_REVIEW_DIR ?? join(contentDir, "..", "docs", "content");
}

/**
 * Committed review receipts keyed by `${reviewer}|${question id}`.
 *
 * CONTENT-POLICY.md requires item-level decisions and the reviewed fingerprint
 * to be recorded in a committed audit. The promotion CLI checks the receipt at
 * promotion time, but nothing would stop a PR from writing
 * `reviewed.by: agent:<name>` plus a locally computed fingerprint straight into
 * the YAML. Loading the receipts here, behind the shared model, makes the
 * committed record the thing that counts for both halves of the gate.
 *
 * A key that appears more than once, in one file or across files, is poisoned
 * rather than resolved last-write-wins: the promotion CLI refuses ambiguous
 * decisions and so does this loader, otherwise a recorded rejection could be
 * overridden by appending an approval.
 */
export function loadReviewReceipts(reviewDir, onError = null) {
  const receipts = new Map();
  const seen = new Set();
  const conflicts = new Set();
  if (!existsSync(reviewDir)) return receipts;
  for (const f of readdirSync(reviewDir)
    .filter((name) => name.endsWith("-review.json"))
    .sort()) {
    const file = join(reviewDir, f);
    let receipt;
    try {
      receipt = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      if (onError) onError(file, `unreadable review receipt: ${e.message}`);
      continue;
    }
    if (typeof receipt?.reviewer !== "string" || !Array.isArray(receipt.questions)) {
      if (onError) onError(file, "review receipt must name a reviewer and list reviewed questions");
      continue;
    }
    for (const entry of receipt.questions) {
      if (typeof entry?.id !== "string") continue;
      const key = `${receipt.reviewer}|${entry.id}`;
      if (seen.has(key)) {
        conflicts.add(key);
        if (onError) onError(file, `more than one receipt entry for ${entry.id} by ${receipt.reviewer}`);
        continue;
      }
      seen.add(key);
      receipts.set(key, entry);
    }
  }
  for (const key of conflicts) receipts.delete(key);
  return receipts;
}

/**
 * Why an agent approval is not backed by the committed receipts. Empty when it
 * is, or when the approval is not an agent's (human approvals carry no receipt).
 */
export function receiptProblems(question, receipts) {
  const review = question?.reviewed;
  if (!review?.by?.startsWith("agent:")) return [];
  if (!(receipts instanceof Map)) return ["agent approval cannot be checked: no review receipts were loaded"];
  const receipt = receipts.get(`${review.by}|${question.id}`);
  if (!receipt) {
    return [
      `approved by ${review.by} without a committed review receipt for ${question.id} — ` +
        "the independent reviewer's decision must be recorded under docs/content/*-review.json",
    ];
  }
  if (receipt.approved !== true)
    return [`the committed receipt for ${question.id} by ${review.by} is not an approval`];
  if (receipt.content_sha256 !== review.content_sha256) {
    return [`the committed receipt for ${question.id} by ${review.by} is for a different revision`];
  }
  return [];
}

/**
 * Reads every *.yaml in content/<dir>, returning { file, name, data } records.
 * A file that will not parse is reported through onError rather than thrown,
 * so a single broken file cannot hide the rest of the tree from the lint.
 */
export function loadYamlDir(contentDir, dir, onError = null) {
  const path = join(contentDir, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort()
    .map((f) => {
      const file = `content/${dir}/${f}`;
      try {
        return { file, name: f, data: parseYaml(readFileSync(join(path, f), "utf8")) };
      } catch (e) {
        if (onError) onError(file, `unparseable YAML: ${e.message}`);
        return null;
      }
    })
    .filter((entry) => entry && entry.data);
}

/** Canonical course metadata, keyed by course id. */
export function loadCourses(contentDir, onError = null) {
  const courses = new Map();
  for (const { data } of loadYamlDir(contentDir, "courses", onError)) {
    if (data?.id) courses.set(data.id, data);
  }
  return courses;
}

/**
 * `domain-N/objective` ids of one course. Throws on an unknown course: an
 * unknown id must fail loudly, never read as "this course has no objectives".
 */
export function courseObjectives(courses, courseId) {
  const course = courses.get(courseId);
  if (!course) {
    throw new Error(`unknown course "${courseId}"; known: ${[...courses.keys()].join(", ") || "none"}`);
  }
  const set = new Set();
  for (const d of course.domains ?? []) for (const o of d.objectives ?? []) set.add(`${d.id}/${o.id}`);
  return set;
}

/** A `domain-N/<objective>` id as the course maps and question files spell it. */
export const OBJECTIVE_ID = /^domain-[1-9][0-9]*\/[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * A comma-separated list (a workflow input) or an array, as distinct trimmed
 * entries. Empty entries are dropped, so "" and [] both mean "none given".
 *
 * @param {string | string[] | null | undefined} value
 * @returns {string[]}
 */
export function splitObjectives(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}

/**
 * Objectives of one course held back from authoring, read from
 * content/coverage/<course>.yaml (`objectives: [{ id, status: open|held }]`).
 *
 * The file is optional: its absence is the one documented "no holds". A file
 * that is present but cannot be read, or whose entries do not name an
 * objective of this course with a known status, throws -- a hold that cannot
 * be read must not quietly turn into "author everything".
 *
 * @param {string} contentDir
 * @param {string} courseId
 * @param {Set<string>} known  the course's `domain-N/<id>` objectives
 * @returns {Set<string>}
 */
export function coverageHolds(contentDir, courseId, known) {
  const file = join(contentDir, "coverage", `${courseId}.yaml`);
  const label = `content/coverage/${courseId}.yaml`;
  if (!existsSync(file)) return new Set();
  let doc;
  try {
    doc = parseYaml(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${label}: unreadable: ${e.message}`);
  }
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.objectives)) {
    throw new Error(`${label}: expected a mapping with an objectives list`);
  }
  const held = new Set();
  for (const [i, entry] of doc.objectives.entries()) {
    const id = entry?.id;
    if (typeof id !== "string" || !OBJECTIVE_ID.test(id)) {
      throw new Error(`${label}: objectives[${i}] has no domain-N/<id> id`);
    }
    if (!known.has(id)) throw new Error(`${label}: ${id} is not an objective of ${courseId}`);
    if (entry.status === "held") held.add(id);
    else if (entry.status !== "open") {
      throw new Error(`${label}: ${id} has status ${JSON.stringify(entry.status)}, expected open or held`);
    }
  }
  return held;
}

/**
 * The objective scope of a replenish run.
 *
 * Unscoped (no course): null, and the run behaves as it always has. A course
 * alone scopes to every open objective of that course; a course plus
 * objectives scopes to exactly those. Objectives without a course, an unknown
 * course or objective, an explicitly requested held objective, or a course
 * whose objectives are all held each throw: every one of them would otherwise
 * become a run that authors something other than what was asked.
 *
 * @param {object} args
 * @param {string} args.contentDir
 * @param {string | null} [args.course]
 * @param {string | string[] | null} [args.objectives]
 * @param {Map<string, object>} [args.courses]
 * @returns {{ course: string, objectives: string[], held: string[] } | null}
 */
export function resolveScope({ contentDir, course = null, objectives = null, courses = null }) {
  const wanted = splitObjectives(objectives);
  if (!course) {
    if (wanted.length) throw new Error("objectives need a course: give the course they belong to");
    return null;
  }
  const known = courseObjectives(courses ?? loadCourses(contentDir), course);
  const held = coverageHolds(contentDir, course, known);
  let target;
  if (wanted.length) {
    const unknown = wanted.filter((o) => !OBJECTIVE_ID.test(o) || !known.has(o));
    if (unknown.length) throw new Error(`not objectives of ${course}: ${unknown.join(", ")}`);
    const asked = wanted.filter((o) => held.has(o));
    if (asked.length) {
      throw new Error(`held in content/coverage/${course}.yaml, not authorable: ${asked.join(", ")}`);
    }
    target = wanted;
  } else {
    target = [...known].filter((o) => !held.has(o));
    if (!target.length) throw new Error(`every objective of ${course} is held; nothing to author`);
  }
  return { course, objectives: target.sort(), held: [...held].sort() };
}

/** Sources keyed by id, for evidence resolution. */
export function loadSources(contentDir, onError = null) {
  const sources = new Map();
  for (const { data } of loadYamlDir(contentDir, "sources", onError)) {
    if (data?.id) sources.set(data.id, data);
  }
  return sources;
}

/**
 * The single eligibility rule.
 *
 * A question may enter the published client bundle only when every one of
 * these holds. Anything else — draft, needs_review, retired, an unresolvable
 * citation, an unsnapshotted source, a drifted or deprecated source — is
 * withdrawn at build time, which is the only withdrawal mechanism this
 * project has: mark the source, rebuild, deploy.
 *
 * Returns the reasons rather than a bare boolean so both callers can say
 * *why* an item was rejected.
 */
export function checkBundleEligibility(question, sourcesById, receipts = null) {
  const reasons = [];

  if (question?.status !== "published") {
    reasons.push(`status is ${question?.status ?? "missing"}, not published`);
  }
  if (question?.status === "published") {
    reasons.push(...reviewProblems(question));
    reasons.push(...receiptProblems(question, receipts));
  }

  const evidence = Array.isArray(question?.evidence) ? question.evidence : [];
  if (evidence.length === 0) {
    reasons.push("has no evidence citation");
  }

  for (const ev of evidence) {
    const source = sourcesById.get(ev?.source_id);
    if (!source) {
      reasons.push(`cites unknown source ${ev?.source_id}`);
      continue;
    }
    if (!source.snapshot) {
      reasons.push(`source ${source.id} has no snapshot to verify against`);
    }
    if (UNUSABLE_SOURCE_STATUSES.has(source.status)) {
      reasons.push(`source ${source.id} is ${source.status}`);
    }
  }

  return { eligible: reasons.length === 0, reasons };
}

export function isEligibleForBundle(question, sourcesById, receipts = null) {
  return checkBundleEligibility(question, sourcesById, receipts).eligible;
}

/**
 * Splits content/questions into what ships and what does not, with the reason
 * for every exclusion. The bundle builder emits `eligible`; the lint uses the
 * same call to report a published question whose evidence disagrees.
 */
export function partitionQuestions(contentDir, onError = null, reviewDir = defaultReviewDir(contentDir)) {
  const sourcesById = loadSources(contentDir, onError);
  const receipts = loadReviewReceipts(reviewDir, onError);
  const entries = loadYamlDir(contentDir, "questions", onError);

  const eligible = [];
  const excluded = [];

  for (const { file, data } of entries) {
    const { eligible: ok, reasons } = checkBundleEligibility(data, sourcesById, receipts);
    if (ok) eligible.push({ file, data });
    else excluded.push({ file, data, reasons });
  }

  return { eligible, excluded, sourcesById, receipts, total: entries.length };
}
