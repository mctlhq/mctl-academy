import { computed, ref, type ComputedRef, type Ref } from "vue";
import { recordAttempt } from "../services/progressStore";
import type { BundleQuestion } from "../services/contentBundle";

export type { BundleOption, BundleQuestion } from "../services/contentBundle";

/**
 * Fisher-Yates, in place on a shallow copy — never mutates the array it is
 * given (usePracticeSession's callers rely on the loaded bundle staying
 * untouched across a whole session).
 */
export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface UsePracticeSessionOptions {
  /** Injectable random source, for deterministic tests. Defaults to Math.random. */
  random?: () => number;
}

export interface PracticeSession {
  /** The current question, or undefined once index has reached total (summary). */
  current: ComputedRef<BundleQuestion | undefined>;
  /** Zero-based index of the current question within this session's shuffled order. */
  index: Ref<number>;
  /** Total questions in this session. */
  total: ComputedRef<number>;
  /** Option ids revealed so far for the *current* question. */
  revealed: ComputedRef<ReadonlySet<string>>;
  /** Count of questions whose first-selected option was correct. */
  score: ComputedRef<number>;
  /** Count of questions attempted (at least one option selected) so far. */
  attempted: ComputedRef<number>;
  /** Reveal one option's correctness/explanation for the current question. */
  selectOption: (optionId: string) => void;
  /** Advance to the next question, or past the last one into the summary. */
  next: () => void;
}

/**
 * A synchronous session engine, and deliberately nothing more: it receives a
 * question list, shuffles it once, and tracks answers against that frozen
 * order.
 *
 * It knows nothing about which course is selected. Course scoping happens
 * before a session exists — the caller passes an already-course-scoped bundle
 * — so a session can never switch course, re-filter, or rebuild because some
 * global state changed underneath it. Changing course discards the session by
 * remounting the screen (see PracticeView/MistakesView's :key), which is the
 * only correct way to end a shuffled, half-answered session.
 */
export function usePracticeSession(
  bundle: readonly BundleQuestion[],
  { random = Math.random }: UsePracticeSessionOptions = {},
): PracticeSession {
  // Built once. Not a computed: a session whose question order can change
  // mid-flight corrupts every index-keyed answer already recorded.
  const session = ref<BundleQuestion[]>(
    shuffle(bundle, random).map((q) => ({ ...q, options: shuffle(q.options, random) })),
  ) as Ref<BundleQuestion[]>;

  const index = ref(0);
  const revealedByQuestion = new Map<number, Set<string>>();
  const firstCorrectByQuestion = new Map<number, boolean>();
  const updateTick = ref(0);

  const total = computed(() => session.value.length);
  const current = computed<BundleQuestion | undefined>(() =>
    index.value < total.value ? session.value[index.value] : undefined,
  );

  const revealed = computed<ReadonlySet<string>>(() => {
    void updateTick.value;
    return revealedByQuestion.get(index.value) ?? new Set<string>();
  });

  function selectOption(optionId: string) {
    const cur = current.value;
    if (!cur) return;
    const set = revealedByQuestion.get(index.value) ?? new Set<string>();
    const isFirstSelection = set.size === 0;
    if (!set.has(optionId)) {
      const nextSet = new Set(set);
      nextSet.add(optionId);
      revealedByQuestion.set(index.value, nextSet);
    }
    if (isFirstSelection) {
      const option = cur.options.find((o) => o.id === optionId);
      const isCorrect = Boolean(option?.correct);
      firstCorrectByQuestion.set(index.value, isCorrect);
      recordAttempt(cur.id, cur.domain, isCorrect);
    }
    updateTick.value += 1;
  }

  function next() {
    index.value = Math.min(index.value + 1, total.value);
  }

  const score = computed(() => {
    void updateTick.value;
    return [...firstCorrectByQuestion.values()].filter(Boolean).length;
  });
  const attempted = computed(() => {
    void updateTick.value;
    return firstCorrectByQuestion.size;
  });

  return { current, index, total, revealed, score, attempted, selectOption, next };
}
