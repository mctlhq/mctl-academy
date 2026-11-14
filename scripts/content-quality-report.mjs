#!/usr/bin/env node
/**
 * Advisory authoring diagnostics, never a substitute for evidence/human review.
 *
 * Every signal here is deterministic and explainable, and none of them changes
 * the exit code: a finding is something to inspect, not a verdict. Only a usage
 * error (an unknown --scope, an --ids entry that is not a candidate) or a
 * malformed allowlist exits non-zero, because those mean the report could not
 * be computed as asked -- "could not observe" is never reported as "clean".
 *
 *   --scope published   (default) score the published bank, as before
 *   --scope candidates  score review_ready items against the published bank
 *   --ids a,b           with candidates: only these review_ready items
 *   --json              machine-readable output (additive: the original keys
 *                       are unchanged, the new ones sit beside them)
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadCourses, loadSources, loadYamlDir } from "./lib/content-model.mjs";

/** Warn levels from the quality specification, calibrated on the 2026-11-14 corpus. */
export const THRESHOLDS = {
  correctLongestShare: 0.45,
  correctLongestShareStrong: 0.6,
  itemLengthRatio: 1.5,
  courseMeanLengthRatio: 1.25,
  shortDistractorFraction: 0.5,
  shortDistractorShare: 0.15,
  absoluteOnlyInDistractorsShare: 0.4,
  sourceShare: 0.2,
  objectiveMinimum: 3,
  volatileShare: 0.25,
  scenarioShareMinimum: 0.35,
  nearDuplicateCosine: 0.6,
  nearDuplicateCosineWithKeyTerms: 0.4,
  nearDuplicateKeyOverlap: 0.8,
  keyTerms: 5,
};

// --- Original word-set Jaccard check, kept for output compatibility ---------

const words = (text) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
const overlap = (a, b) => {
  const left = words(a),
    right = words(b);
  const intersection = [...left].filter((w) => right.has(w)).length;
  return intersection / (new Set([...left, ...right]).size || 1);
};

// --- Item-level cues ---------------------------------------------------------

const correctOf = (q) => q.options.find((o) => o.correct);
const distractorsOf = (q) => q.options.filter((o) => !o.correct);
const len = (o) => o.text.trim().length;

const ABSOLUTE = /\b(always|never|only)\b/i;

// Number followed by a unit: durations, sizes, rates, counts of hardware.
const NUMBER_UNIT =
  /\b\d+(?:[.,]\d+)?\s?(?:%|percent|ms|milliseconds?|s|secs?|seconds?|mins?|minutes?|h|hrs?|hours?|days?|weeks?|months?|kb|mb|gb|tb|kib|mib|gib|tib|tokens?|[kmb]\s?tokens|gpus?|vcpus?|cpus?|cores?|nodes?|replicas?|requests?|rps|qps|rpm|tpm|credits?|usd|dollars?|cents?|eur|gbit|gbps|mbps|tflops|pflops|watts?|w|kw)\b(?!\/)/i;
// Version strings: v2, v1.3, 3.1.4. A path segment such as /v1/ is an API
// route, not a release, so a preceding slash disqualifies the match.
const VERSION = /(?<![/\w.])(?:v\d+(?:\.\d+)*|\d+\.\d+\.\d+)\b(?!\/)/i;
const CLI_FLAG = /(?:^|[\s`'"(])--[a-z][a-z0-9-]+/i;
const PRICE = /(?:[$€£]\s?\d)|\b\d+(?:\.\d+)?\s?(?:usd|eur)\b|\bper (?:million|thousand|1[mk]) tokens\b/i;

/** Which volatile-fact patterns a text contains, by name. */
export function volatileKinds(text) {
  const kinds = [];
  if (NUMBER_UNIT.test(text)) kinds.push("number+unit");
  if (VERSION.test(text)) kinds.push("version");
  if (CLI_FLAG.test(text)) kinds.push("cli-flag");
  if (PRICE.test(text)) kinds.push("price");
  return kinds;
}

// Crude on purpose and labelled as such: a stem that puts an actor or a
// situation in front of the question. It undercounts terse scenarios and
// overcounts padded recall, which is why the scenario share is advisory only.
const SCENARIO =
  /\b(?:a|an|the|your|one|some)\s+(?:\w+[- ])?(?:team|company|engineer|developer|operator|customer|user|startup|organi[sz]ation|platform|pipeline|service|agent|application|app|workload|job|cluster|deployment|endpoint|model|researcher|architect|admin(?:istrator)?|analyst|manager|lead|robot|fleet)\b[^?]*\b(?:wants?|needs?|is|are|was|were|has|have|must|plans?|notices?|observes?|sees?|reports?|runs?|deploys?|builds?|uses?|calls?|sends?|gets?|receives?|returns?|fails?|keeps?|starts?|tries?)\b|\b(?:you are|you're|you need|you want|you have|your (?:team|company|agent|pipeline|application))\b|\b(?:after|while|during|when|because|since)\b[^?]{12,}[,.]/i;

export const isScenarioStem = (stem) => SCENARIO.test(stem);

/** Item-level cue flags for one question. Every flag carries its own evidence. */
export function itemCues(q) {
  const flags = [];
  const correct = correctOf(q);
  const distractors = distractorsOf(q);
  if (!correct || distractors.length === 0) return { id: q.id, flags, lengthRatio: null };
  const cLen = len(correct);
  const meanDistractor = distractors.reduce((s, o) => s + len(o), 0) / distractors.length;
  const lengthRatio = meanDistractor ? cLen / meanDistractor : null;
  if (distractors.every((o) => cLen > len(o))) flags.push({ check: "correct-longest" });
  if (lengthRatio !== null && lengthRatio > THRESHOLDS.itemLengthRatio) {
    flags.push({ check: "length-ratio", value: round(lengthRatio) });
  }
  const short = distractors.filter((o) => len(o) < cLen * THRESHOLDS.shortDistractorFraction);
  if (short.length) flags.push({ check: "short-distractor", options: short.map((o) => o.id ?? o.text) });
  const absDistractors = distractors.filter((o) => ABSOLUTE.test(o.text));
  if (absDistractors.length && !ABSOLUTE.test(correct.text)) {
    flags.push({ check: "absolute-only-in-distractors", options: absDistractors.map((o) => o.id ?? o.text) });
  }
  const volatile = [...new Set([q.stem, ...q.options.map((o) => o.text)].flatMap((t) => volatileKinds(t)))];
  if (volatile.length) flags.push({ check: "volatile", kinds: volatile });
  return {
    id: q.id,
    flags,
    lengthRatio: lengthRatio === null ? null : round(lengthRatio),
    scenario: isScenarioStem(q.stem),
  };
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const share = (n, d) => (d ? round(n / d) : null);

// --- Near-duplicates: TF-IDF cosine on stem + correct option -----------------

const STOPWORDS = new Set(
  (
    "a an the and or but if then else of to in on at by for with without from into onto over under about " +
    "as is are was were be been being am do does did doing done has have had having can could should would " +
    "will shall may might must it its it's this that these those there here their they them he she his her " +
    "we our us you your i me my not no nor so than too very just also only each every any all both either " +
    "neither some such more most less least other another same which what who whom whose when where why how " +
    "per according documentation docs doc documented reference guide page describes describe described " +
    "following best option options answer correct true false statement question use using used uses via " +
    "one two three four first second need needs want wants make makes get gets set sets"
  ).split(" "),
);
const VENDORS = new Set(
  (
    "nebius tavily nvidia openai anthropic claude google gemini aws amazon azure microsoft meta hugging face " +
    "huggingface mctl tokenfactory"
  ).split(" "),
);

function stemWord(w) {
  if (w.length <= 4 || /\d/.test(w)) return w;
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.endsWith("ing") && w.length - 3 >= 3) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length - 2 >= 3) return w.slice(0, -2);
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Lowercased, stopword- and vendor-free, lightly stemmed terms. */
export function terms(text) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w) && !VENDORS.has(w))
    .map(stemWord);
}

function tfidfIndex(items) {
  const docs = items.map((q) => terms(`${q.stem} ${correctOf(q)?.text ?? ""}`));
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const idf = (t) => Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;
  const vectors = docs.map((d) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v = new Map();
    let norm = 0;
    for (const [t, c] of tf) {
      const w = c * idf(t);
      v.set(t, w);
      norm += w * w;
    }
    return { v, norm: Math.sqrt(norm) };
  });
  const keyTerms = items.map((q) =>
    [...new Set(terms(correctOf(q)?.text ?? ""))]
      .sort((a, b) => idf(b) - idf(a) || a.localeCompare(b))
      .slice(0, THRESHOLDS.keyTerms),
  );
  return { vectors, keyTerms };
}

function cosine(a, b) {
  if (!a.norm || !b.norm) return 0;
  const [small, large] = a.v.size <= b.v.size ? [a.v, b.v] : [b.v, a.v];
  let dot = 0;
  for (const [t, w] of small) dot += w * (large.get(t) ?? 0);
  return dot / (a.norm * b.norm);
}

function keyOverlap(a, b) {
  if (!a.length || !b.length) return 0;
  const right = new Set(b);
  return a.filter((t) => right.has(t)).length / Math.max(a.length, b.length);
}

const pairKey = (a, b) => [a, b].sort().join("\u0000");

/**
 * Near-duplicate pairs among `corpus`, restricted to pairs with at least one
 * member in `focus` (all of the corpus when omitted). Pairs are computed across
 * courses and labelled; an allowlisted pair is kept, marked, and not counted.
 */
export function nearDuplicates(corpus, { focus = null, allowlist = new Map() } = {}) {
  const { vectors, keyTerms } = tfidfIndex(corpus);
  const inFocus = focus ? corpus.map((q) => focus.has(q.id)) : corpus.map(() => true);
  const pairs = [];
  for (let i = 0; i < corpus.length; i++) {
    for (let j = i + 1; j < corpus.length; j++) {
      if (!inFocus[i] && !inFocus[j]) continue;
      const cos = cosine(vectors[i], vectors[j]);
      if (cos < THRESHOLDS.nearDuplicateCosineWithKeyTerms) continue;
      const key = keyOverlap(keyTerms[i], keyTerms[j]);
      if (
        cos < THRESHOLDS.nearDuplicateCosine &&
        !(cos >= THRESHOLDS.nearDuplicateCosineWithKeyTerms && key >= THRESHOLDS.nearDuplicateKeyOverlap)
      ) {
        continue;
      }
      const a = corpus[i],
        b = corpus[j];
      const pair = {
        ids: [a.id, b.id],
        courses: [a.course_id, b.course_id],
        relation: a.course_id === b.course_id ? "same-course" : "cross-course",
        cosine: round(cos),
        keyOverlap: round(key),
        keyTerms: [keyTerms[i], keyTerms[j]],
      };
      const reason = allowlist.get(pairKey(a.id, b.id));
      if (reason) pair.allowlisted = reason;
      pairs.push(pair);
    }
  }
  return pairs.sort((x, y) => y.cosine - x.cosine || x.ids.join().localeCompare(y.ids.join()));
}

// --- Allowlist ---------------------------------------------------------------

/**
 * Parses content/quality-allowlist.yaml into Map(pairKey -> reason). A missing
 * file is an empty allowlist; a present but malformed one throws, so a typo
 * can never silently un-suppress or suppress everything.
 */
export function parseAllowlist(data, file = "content/quality-allowlist.yaml") {
  const map = new Map();
  if (data === null || data === undefined) return map;
  if (typeof data !== "object" || !Array.isArray(data.pairs)) {
    throw new Error(`${file}: expected a mapping with a "pairs" list`);
  }
  data.pairs.forEach((entry, i) => {
    const pair = entry?.pair;
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !pair.every((id) => typeof id === "string" && id) ||
      pair[0] === pair[1]
    ) {
      throw new Error(`${file}: pairs[${i}].pair must be two distinct question ids`);
    }
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      throw new Error(`${file}: pairs[${i}].reason must be a non-empty string`);
    }
    map.set(pairKey(pair[0], pair[1]), entry.reason.trim());
  });
  return map;
}

export function loadAllowlist(contentDir) {
  const file = join(contentDir, "quality-allowlist.yaml");
  if (!existsSync(file)) return new Map();
  return parseAllowlist(parseYaml(readFileSync(file, "utf8")));
}

// --- Report ------------------------------------------------------------------

const normaliseExcerpt = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function courseObjectiveIds(course) {
  return course.domains.flatMap((d) => d.objectives.map((o) => `${d.id}/${o.id}`));
}

/**
 * Per-course report. `scope` decides which items are scored:
 * - "published": the published bank (the original behaviour);
 * - "candidates": review_ready items (optionally only `ids`), compared against
 *   the published bank. Source share and objective coverage then describe the
 *   bank as it would be if every candidate were accepted.
 * The original keys (published, needsReview, longestCorrect, ...) always
 * describe the published bank, whatever the scope.
 */
export function qualityReport({
  courses,
  sources,
  questions,
  scope = "published",
  ids = null,
  allowlist = new Map(),
}) {
  if (scope !== "published" && scope !== "candidates") throw new Error(`unknown scope "${scope}"`);
  const published = questions.filter((q) => q.status === "published");
  let candidates = [];
  if (scope === "candidates") {
    candidates = questions.filter((q) => q.status === "review_ready");
    if (ids) {
      const byId = new Map(questions.map((q) => [q.id, q]));
      const bad = ids.filter((id) => byId.get(id)?.status !== "review_ready");
      if (bad.length) throw new Error(`--ids are not review_ready items: ${bad.join(", ")}`);
      const wanted = new Set(ids);
      candidates = candidates.filter((q) => wanted.has(q.id));
    }
  }
  const scored = scope === "published" ? published : candidates;
  const scoredIds = new Set(scored.map((q) => q.id));
  const corpus = scope === "published" ? published : [...published, ...candidates];

  const dupPairs = nearDuplicates(corpus, { focus: scoredIds, allowlist });

  const excerptGroups = new Map();
  for (const q of corpus) {
    for (const ev of q.evidence) {
      const key = normaliseExcerpt(ev.excerpt);
      if (!excerptGroups.has(key)) excerptGroups.set(key, new Set());
      excerptGroups.get(key).add(q.id);
    }
  }
  const courseOf = new Map(corpus.map((q) => [q.id, q.course_id]));
  // Only groups that touch a scored item: in candidate scope, reuse that lies
  // entirely inside the published bank is not the candidates' finding.
  const reusedExcerpts = [...excerptGroups.entries()]
    .filter(([, set]) => set.size > 1 && [...set].some((id) => scoredIds.has(id)))
    .map(([excerpt, set]) => ({ excerpt, ids: [...set].sort() }));

  return [...courses.values()].map((course) => {
    const bank = questions.filter((q) => q.course_id === course.id && q.status === "published");
    const citationGroups = new Map();
    const sourceObjectiveMismatches = [];
    const longestCorrect = [];
    for (const q of bank) {
      const correct = q.options.find((o) => o.correct);
      if (correct && q.options.every((o) => o.correct || correct.text.length > o.text.length))
        longestCorrect.push(q.id);
      for (const ev of q.evidence) {
        const key = `${ev.source_id}:${ev.excerpt.replace(/\s+/g, " ").trim()}`;
        if (!citationGroups.has(key)) citationGroups.set(key, []);
        citationGroups.get(key).push(q.id);
      }
      const mapped = q.evidence.some((ev) => {
        const source = sources.get(ev.source_id);
        return (
          source?.coverage?.some((c) => c.course_id === course.id && c.objective === q.objective) ||
          source?.objectives?.includes(q.objective)
        );
      });
      if (!mapped) sourceObjectiveMismatches.push(q.id);
    }
    const similarQuestions = [];
    for (let i = 0; i < bank.length; i++) {
      for (let j = i + 1; j < bank.length; j++) {
        const a = bank[i],
          b = bank[j];
        const stemSimilarity = overlap(a.stem, b.stem);
        const answerSimilarity = overlap(
          a.options.find((o) => o.correct)?.text ?? "",
          b.options.find((o) => o.correct)?.text ?? "",
        );
        if (stemSimilarity >= 0.6 || (stemSimilarity >= 0.2 && answerSimilarity >= 0.8)) {
          similarQuestions.push({ ids: [a.id, b.id], stemSimilarity, answerSimilarity });
        }
      }
    }
    const domains = course.domains.map((d) => {
      const inDomain = bank.filter((q) => q.domain === d.id);
      return {
        id: d.id,
        weight: d.weight,
        published: inDomain.length,
        bankPercent: bank.length ? Math.round((inDomain.length / bank.length) * 100) : 0,
        mockNeeded: d.mock_questions,
        mockShortfall: Math.max(0, d.mock_questions - inDomain.length),
        objectives: d.objectives.map((o) => ({
          id: o.id,
          published: inDomain.filter((q) => q.objective === `${d.id}/${o.id}`).length,
        })),
      };
    });

    // --- new, additive diagnostics ---
    // Item flags are the per-item signal and cover only the scored items.
    // Course-level shares are never taken over the candidate sample alone,
    // which is too small to mean anything: `metrics` describes the course
    // after the scored items (the published bank plus the candidates), and
    // `metricsBefore` the published bank alone. In published scope the two
    // are the same population.
    const items = scored.filter((q) => q.course_id === course.id);
    const cues = items.map(itemCues);
    const courseBank = corpus.filter((q) => q.course_id === course.id);
    const metrics = metricsOf(courseBank);
    const metricsBefore = metricsOf(bank);
    const perSource = new Map();
    for (const q of courseBank) {
      for (const sid of new Set(q.evidence.map((ev) => ev.source_id))) {
        perSource.set(sid, (perSource.get(sid) ?? 0) + 1);
      }
    }
    const sourceShares = [...perSource.entries()]
      .map(([source_id, n]) => ({ source_id, items: n, share: share(n, courseBank.length) }))
      .sort((a, b) => b.items - a.items || a.source_id.localeCompare(b.source_id));

    const objectiveCoverage = courseObjectiveIds(course).map((objective) => {
      const n = courseBank.filter((q) => q.objective === objective).length;
      return {
        objective,
        items: n,
        status: n === 0 ? "missing" : n < THRESHOLDS.objectiveMinimum ? "thin" : "ok",
      };
    });

    // Per course, as the spec says: the cross-course angle rule allows the
    // same source to back a different angle in another course, so reuse that
    // crosses a course boundary is counted for information, never warned on.
    const excerptReuse = [];
    const crossCourseExcerptReuse = [];
    for (const g of reusedExcerpts) {
      const mine = g.ids.filter((id) => courseOf.get(id) === course.id);
      if (!mine.length) continue;
      if (mine.length > 1) excerptReuse.push({ excerpt: g.excerpt, ids: mine });
      if (mine.length < g.ids.length) {
        crossCourseExcerptReuse.push({
          excerpt: g.excerpt,
          ids: g.ids,
          courses: [...new Set(g.ids.map((id) => courseOf.get(id)))].sort(),
        });
      }
    }
    const courseDuplicates = dupPairs.filter((p) => p.courses.includes(course.id));

    const warnings = [];
    const warn = (check, value, threshold, message, level = "warn") =>
      warnings.push({ check, level, value, threshold, message });
    // In candidate scope a course no candidate touches has nothing new to say;
    // its bank-level findings belong to the published-scope report.
    const courseLevel = scope === "published" || items.length > 0;
    if (courseLevel && metrics.items) {
      if (metrics.correctLongestShare > THRESHOLDS.correctLongestShare) {
        const strong = metrics.correctLongestShare > THRESHOLDS.correctLongestShareStrong;
        warn(
          "correct-longest",
          metrics.correctLongestShare,
          strong ? THRESHOLDS.correctLongestShareStrong : THRESHOLDS.correctLongestShare,
          `correct option is strictly longest in ${pct(metrics.correctLongestShare)} of ${metrics.items} items (random is about 25%)`,
          strong ? "strong" : "warn",
        );
      }
      if (metrics.meanLengthRatio > THRESHOLDS.courseMeanLengthRatio) {
        warn(
          "length-ratio",
          metrics.meanLengthRatio,
          THRESHOLDS.courseMeanLengthRatio,
          `mean correct/distractor length ratio ${metrics.meanLengthRatio}`,
        );
      }
      if (metrics.shortDistractorShare > THRESHOLDS.shortDistractorShare) {
        warn(
          "short-distractor",
          metrics.shortDistractorShare,
          THRESHOLDS.shortDistractorShare,
          `${pct(metrics.shortDistractorShare)} of items have a distractor under half the correct option's length`,
        );
      }
      if (metrics.absoluteOnlyInDistractorsShare > THRESHOLDS.absoluteOnlyInDistractorsShare) {
        warn(
          "absolute-only-in-distractors",
          metrics.absoluteOnlyInDistractorsShare,
          THRESHOLDS.absoluteOnlyInDistractorsShare,
          `${pct(metrics.absoluteOnlyInDistractorsShare)} of items use always/never/only in distractors only`,
        );
      }
      if (metrics.volatileShare > THRESHOLDS.volatileShare) {
        warn(
          "volatile",
          metrics.volatileShare,
          THRESHOLDS.volatileShare,
          `${pct(metrics.volatileShare)} of items carry a number+unit, version, CLI flag or price`,
        );
      }
      if (metrics.scenarioShare < THRESHOLDS.scenarioShareMinimum) {
        warn(
          "scenario-share",
          metrics.scenarioShare,
          THRESHOLDS.scenarioShareMinimum,
          `only ${pct(metrics.scenarioShare)} of stems read as scenarios (crude classifier, advisory)`,
          "advisory",
        );
      }
    }
    for (const s of courseLevel ? sourceShares.filter((x) => x.share > THRESHOLDS.sourceShare) : []) {
      warn(
        "source-share",
        s.share,
        THRESHOLDS.sourceShare,
        `${s.source_id} backs ${pct(s.share)} of the course`,
      );
    }
    for (const o of courseLevel ? objectiveCoverage.filter((x) => x.status !== "ok") : []) {
      warn(
        o.status === "missing" ? "objective-missing" : "objective-thin",
        o.items,
        THRESHOLDS.objectiveMinimum,
        `${o.objective} has ${o.items} item(s)`,
      );
    }
    for (const g of excerptReuse) {
      warn("excerpt-reuse", g.ids.length, 2, `same excerpt in ${g.ids.join(", ")}`);
    }
    for (const p of courseDuplicates.filter((x) => !x.allowlisted)) {
      warn(
        "near-duplicate",
        p.cosine,
        THRESHOLDS.nearDuplicateCosine,
        `${p.relation} ${p.ids.join(" / ")} (cosine ${p.cosine}, key-term overlap ${p.keyOverlap})`,
      );
    }

    return {
      course: course.id,
      published: bank.length,
      needsReview: questions.filter((q) => q.course_id === course.id && q.status === "needs_review").length,
      longestCorrect,
      sourceObjectiveMismatches,
      domains,
      repeatedCitations: [...citationGroups.values()].filter((ids) => ids.length > 1),
      similarQuestions,
      scope,
      scored: items.map((q) => q.id),
      bankItems: courseBank.length,
      metrics,
      metricsBefore,
      itemFlags: cues.filter((c) => c.flags.length).map(({ id, flags }) => ({ id, flags })),
      sourceShares,
      objectiveCoverage,
      excerptReuse,
      crossCourseExcerptReuse,
      crossCourseExcerptReuseCount: crossCourseExcerptReuse.length,
      nearDuplicates: courseDuplicates,
      warnings,
    };
  });
}

/** Course-level cue shares over one population of items. */
function metricsOf(population) {
  const cues = population.map(itemCues);
  const count = (check) => cues.filter((c) => c.flags.some((f) => f.check === check)).length;
  const ratios = cues.map((c) => c.lengthRatio).filter((r) => r !== null);
  const n = population.length;
  return {
    items: n,
    correctLongestShare: share(count("correct-longest"), n),
    meanLengthRatio: ratios.length ? round(ratios.reduce((s, r) => s + r, 0) / ratios.length) : null,
    lengthRatioItems: count("length-ratio"),
    shortDistractorShare: share(count("short-distractor"), n),
    absoluteOnlyInDistractorsShare: share(count("absolute-only-in-distractors"), n),
    volatileShare: share(count("volatile"), n),
    scenarioShare: share(cues.filter((c) => c.scenario).length, n),
    scenarioShareNote: "crude, advisory: a regex classifier, never a gate",
  };
}

const pct = (x) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new Error(`--${name} needs a value`);
  return argv[i + 1];
}

function main(argv) {
  const contentDir = process.env.ACADEMY_CONTENT_DIR ?? fileURLToPath(new URL("../content", import.meta.url));
  const scope = arg(argv, "scope") ?? "published";
  const idsArg = arg(argv, "ids");
  if (idsArg && scope !== "candidates") throw new Error("--ids needs --scope candidates");
  const questions = loadYamlDir(contentDir, "questions").map((e) => e.data);
  const allowlist = loadAllowlist(contentDir);
  const known = new Set(questions.map((q) => q.id));
  for (const key of allowlist.keys()) {
    const unknown = key.split("\u0000").filter((id) => !known.has(id));
    if (unknown.length)
      console.error(`warning: quality-allowlist.yaml names unknown question(s) ${unknown.join(", ")}`);
  }
  const report = qualityReport({
    courses: loadCourses(contentDir),
    sources: loadSources(contentDir),
    questions,
    scope,
    ids: idsArg
      ? idsArg
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : null,
    allowlist,
  });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(
    "Advisory content quality report: signals require inspection, not automatic approval or rewriting.",
  );
  if (scope === "candidates") {
    const n = report.reduce((s, c) => s + c.scored.length, 0);
    console.log(`Scope: ${n} review_ready candidate(s), compared against the published bank.`);
  }
  for (const c of report) {
    console.log(`\n${c.course}: ${c.published} published; ${c.needsReview} need review`);
    console.log(
      `Strictly longest correct option: ${c.longestCorrect.length}/${c.published}; source/objective mismatches: ${c.sourceObjectiveMismatches.length}`,
    );
    for (const d of c.domains) {
      console.log(
        `${d.id}: ${d.published} questions (${d.bankPercent}% of bank vs ${d.weight}% weight); mock shortfall ${d.mockShortfall}`,
      );
      console.log(`  Objectives: ${d.objectives.map((o) => `${o.id}=${o.published}`).join(", ")}`);
    }
    for (const ids of c.repeatedCitations) console.log(`Repeated citation: ${ids.join(", ")}`);
    for (const pair of c.similarQuestions) console.log(`Similar question/answer: ${pair.ids.join(", ")}`);
    if (c.sourceObjectiveMismatches.length)
      console.log(`Check mappings: ${c.sourceObjectiveMismatches.join(", ")}`);
    const m = c.metrics;
    const b = c.metricsBefore;
    const v = (f, key) => (scope === "candidates" ? `${f(b[key])}→${f(m[key])}` : f(m[key]));
    const num = (x) => (x === null ? "n/a" : String(x));
    console.log(
      `Diagnostics over ${scope === "candidates" ? `${b.items}→${m.items} items (published → with ${c.scored.length} candidate(s))` : `${m.items} published item(s)`}: ` +
        `correct longest ${v(pct, "correctLongestShare")}, mean length ratio ${v(num, "meanLengthRatio")}, ` +
        `short distractor ${v(pct, "shortDistractorShare")}, absolutes only in distractors ${v(pct, "absoluteOnlyInDistractorsShare")}, ` +
        `volatile ${v(pct, "volatileShare")}, scenario stems ${v(pct, "scenarioShare")} (crude, advisory); ` +
        `top source ${c.sourceShares[0] ? `${c.sourceShares[0].source_id} ${pct(c.sourceShares[0].share)}` : "n/a"}; ` +
        `cross-course excerpt reuse ${c.crossCourseExcerptReuseCount} (info)`,
    );
    for (const w of c.warnings) console.log(`  [${w.level}] ${w.check}: ${w.message}`);
    for (const p of c.nearDuplicates.filter((x) => x.allowlisted)) {
      console.log(`  [allowlisted] ${p.ids.join(" / ")}: ${p.allowlisted}`);
    }
    for (const f of c.itemFlags) {
      console.log(
        `  item ${f.id}: ${f.flags.map((x) => x.check + (x.kinds ? `(${x.kinds.join("/")})` : "")).join(", ")}`,
      );
    }
  }
  console.log(`\nEvidence policy: ${join(contentDir, "..", "CONTENT-POLICY.md")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`content-quality-report: ${e.message}`);
    process.exit(2);
  }
}
