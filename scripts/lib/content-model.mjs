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
 * Hosts content may cite. Mirrors the SOURCES.md allowlist; the lint and the
 * generated-artefact contract both read it from here so they cannot drift.
 */
export const ALLOWED_HOSTS = ["docs.tokenfactory.nebius.com", "docs.nebius.com"];

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
