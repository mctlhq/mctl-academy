import { useCallback, useMemo, useRef, useState } from "react";
import rawBundle from "../content-bundle.json";

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
  current: BundleQuestion | undefined;
  /** Zero-based index of the current question within this session's shuffled order. */
  index: number;
  /** Total questions in this session (the full published bank, shuffled once). */
  total: number;
  /** Option ids revealed so far for the *current* question. */
  revealed: ReadonlySet<string>;
  /** Count of questions whose first-selected option was correct. */
  score: number;
  /** Count of questions attempted (at least one option selected) so far. */
  attempted: number;
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
  // Shuffled exactly once per mount: a lazy useState initializer, not
  // useMemo, so React StrictMode's dev-mode double-render of a *committed*
  // state initializer still only re-runs shuffling if the component
  // actually remounts, matching "once per session".
  const [session] = useState<BundleQuestion[]>(() => buildSession(bundle, random));
  const [index, setIndex] = useState(0);
  const revealedByQuestion = useRef<Map<number, Set<string>>>(new Map());
  const firstCorrectByQuestion = useRef<Map<number, boolean>>(new Map());
  // Bumped on every mutation of the refs above so components re-render.
  const [updateTick, forceUpdate] = useState(0);

  const total = session.length;
  const current = index < total ? session[index] : undefined;

  const revealed = useMemo(
    () => revealedByQuestion.current.get(index) ?? new Set<string>(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, updateTick],
  );

  const selectOption = useCallback(
    (optionId: string) => {
      if (!current) return;
      const set = revealedByQuestion.current.get(index) ?? new Set<string>();
      const isFirstSelection = set.size === 0;
      if (!set.has(optionId)) {
        const next = new Set(set);
        next.add(optionId);
        revealedByQuestion.current.set(index, next);
      }
      if (isFirstSelection) {
        const option = current.options.find((o) => o.id === optionId);
        firstCorrectByQuestion.current.set(index, Boolean(option?.correct));
      }
      forceUpdate((n) => n + 1);
    },
    [current, index],
  );

  const next = useCallback(() => {
    setIndex((i) => Math.min(i + 1, total));
  }, [total]);

  const score = useMemo(
    () => [...firstCorrectByQuestion.current.values()].filter(Boolean).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateTick, index],
  );
  const attempted = useMemo(
    () => firstCorrectByQuestion.current.size,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateTick, index],
  );

  return { current, index, total, revealed, score, attempted, selectOption, next };
}
