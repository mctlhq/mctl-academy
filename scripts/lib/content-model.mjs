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

/** Source states that permanently disqualify anything citing them. */
export const UNUSABLE_SOURCE_STATUSES = new Set(["drifted", "deprecated"]);

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
export function checkBundleEligibility(question, sourcesById) {
  const reasons = [];

  if (question?.status !== "published") {
    reasons.push(`status is ${question?.status ?? "missing"}, not published`);
  }
  if (question?.status === "published" && !question?.reviewed) {
    reasons.push("published without a `reviewed` block — human approval is not optional");
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

export function isEligibleForBundle(question, sourcesById) {
  return checkBundleEligibility(question, sourcesById).eligible;
}

/**
 * Splits content/questions into what ships and what does not, with the reason
 * for every exclusion. The bundle builder emits `eligible`; the lint uses the
 * same call to report a published question whose evidence disagrees.
 */
export function partitionQuestions(contentDir, onError = null) {
  const sourcesById = loadSources(contentDir, onError);
  const entries = loadYamlDir(contentDir, "questions", onError);

  const eligible = [];
  const excluded = [];

  for (const { file, data } of entries) {
    const { eligible: ok, reasons } = checkBundleEligibility(data, sourcesById);
    if (ok) eligible.push({ file, data });
    else excluded.push({ file, data, reasons });
  }

  return { eligible, excluded, sourcesById, total: entries.length };
}
