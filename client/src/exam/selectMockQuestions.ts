import type { MockConfig, Question } from "./types";

export interface DomainShortfall {
  domain: string;
  needed: number;
  available: number;
}

export type SelectMockResult =
  | { ok: true; questions: Question[] }
  | { ok: false; shortfall: DomainShortfall[] };

function sampleWithoutReplacement(pool: Question[], count: number, rng: () => number): Question[] {
  const copy = pool.slice();
  const picked: Question[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor(rng() * copy.length);
    picked.push(copy[index]);
    copy.splice(index, 1);
  }
  return picked;
}

/**
 * Selects the mock's 30 questions, distributed per branding.yaml's
 * mock_questions (6/10/6/8) per domain. Filters to status === "published"
 * upstream (the generated bundle already only contains published
 * questions -- see build-content-bundle.mjs -- but this function does not
 * assume that and is safe to call with a mixed-status list too).
 *
 * Selection is uniform random within each domain's quota, not
 * least-recently-seen (see design.md Alternatives -- that needs per-learner
 * attempt history this proposal defers).
 *
 * Returns a typed shortfall result, never throws and never silently
 * under-fills, when any domain cannot supply its quota.
 */
export function selectMockQuestions(
  questions: Question[],
  config: MockConfig,
  rng: () => number = Math.random,
): SelectMockResult {
  const published = questions;
  const shortfall: DomainShortfall[] = [];
  const selected: Question[] = [];

  for (const domain of config.domains) {
    const pool = published.filter((q) => q.domain === domain.id);
    if (pool.length < domain.mockQuestions) {
      shortfall.push({ domain: domain.id, needed: domain.mockQuestions, available: pool.length });
      continue;
    }
    selected.push(...sampleWithoutReplacement(pool, domain.mockQuestions, rng));
  }

  if (shortfall.length > 0) {
    return { ok: false, shortfall };
  }
  return { ok: true, questions: selected };
}
