import { computed, ref, type ComputedRef, type Ref } from "vue";
import rawBundle from "../content-bundle.json";
import { recordAttempt } from "../services/progressStore";

export interface BundleOption {
  id: string;
  text: string;
  correct: boolean;
  explanation: string;
}

export interface BundleQuestion {
  id: string;
  domain: string;
  objective: string;
  stem: string;
  options: BundleOption[];
}

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

function buildSession(bundle: readonly BundleQuestion[], random: () => number): BundleQuestion[] {
  return shuffle(bundle, random).map((q) => ({ ...q, options: shuffle(q.options, random) }));
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
  /** Total questions in this session (the full published bank, shuffled once). */
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

const defaultBundle = rawBundle as unknown as BundleQuestion[];

export function usePracticeSession(
  bundle: readonly BundleQuestion[] = defaultBundle,
  { random = Math.random }: UsePracticeSessionOptions = {},
): PracticeSession {
  // Shuffled exactly once per call: session is a plain ref seeded at
  // creation time, matching "once per session" — there is no React-style
  // remount to guard against here, a composable instance lives exactly as
  // long as its caller keeps it.
  const session = ref<BundleQuestion[]>(buildSession(bundle, random)) as Ref<BundleQuestion[]>;
  const index = ref(0);
  const revealedByQuestion = new Map<number, Set<string>>();
  const firstCorrectByQuestion = new Map<number, boolean>();
  // Bumped on every mutation of the plain (non-reactive) maps above so
  // dependent computeds re-evaluate.
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
      const next = new Set(set);
      next.add(optionId);
      revealedByQuestion.set(index.value, next);
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
