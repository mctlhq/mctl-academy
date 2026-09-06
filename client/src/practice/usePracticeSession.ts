import { computed, getCurrentScope, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import {
  getStoredAttempts,
  latestPerQuestion,
  progressEpoch,
  recordAttempt,
} from "../services/progressStore";
import { getItem, setItem } from "../services/storage";
import type { BundleQuestion } from "../services/contentBundle";

export type { BundleOption, BundleQuestion } from "../services/contentBundle";
export type PracticeMode = "remaining" | "mistakes" | "all";

export function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

interface QueueEntry {
  id: string;
  optionIds: string[];
  signature: string;
  revealed: string[];
  firstCorrect?: boolean;
}
interface SavedSession {
  version: 1;
  epoch: string;
  index: number;
  entries: QueueEntry[];
}
export interface UsePracticeSessionOptions {
  random?: () => number;
  storageKey?: string;
  mode?: PracticeMode;
}

/** Device-local cursor scoped independently of the legacy attempt log. */
export function practiceStorageKey(owner: string | null, course: string, mode: PracticeMode, domain = "") {
  return "academy.practice.v1." + JSON.stringify([owner, course, mode, domain]);
}
const signature = (q: BundleQuestion) => JSON.stringify([q.stem, q.options]);

export function usePracticeSession(
  bundle: MaybeRefOrGetter<readonly BundleQuestion[]>,
  { random = Math.random, storageKey, mode = "all" }: UsePracticeSessionOptions = {},
) {
  const entries = ref<QueueEntry[]>([]);
  const index = ref(0);
  const byId = () => new Map(toValue(bundle).map((q) => [q.id, q]));
  const latest = () => new Map(latestPerQuestion(getStoredAttempts()).map((a) => [a.questionId, a]));

  function eligibleQuestions() {
    const attempts = latest();
    return toValue(bundle).filter((q) => {
      const a = attempts.get(q.id);
      return mode === "all" || (mode === "mistakes" ? a?.correct === false : !a?.correct);
    });
  }

  function makeEntries(questions: readonly BundleQuestion[]): QueueEntry[] {
    const attempts = latest();
    const unseen = shuffle(
      questions.filter((q) => !attempts.has(q.id)),
      random,
    );
    const seen = shuffle(
      questions.filter((q) => attempts.has(q.id)),
      random,
    );
    const order = [...unseen, ...seen];
    return order.map((q) => ({
      id: q.id,
      optionIds: shuffle(q.options, random).map((o) => o.id),
      signature: signature(q),
      revealed: [],
    }));
  }
  function save() {
    if (!storageKey) return;
    setItem(
      storageKey,
      JSON.stringify({ version: 1, epoch: progressEpoch.value, index: index.value, entries: entries.value }),
    );
  }
  function restart() {
    entries.value = makeEntries(eligibleQuestions());
    index.value = 0;
    save();
  }

  // Validate persisted cursor shape; publication eligibility remains a build-time rule.
  function restore(): boolean {
    if (!storageKey) return false;
    try {
      const saved: SavedSession = JSON.parse(getItem(storageKey) ?? "null");
      if (
        !saved ||
        saved.version !== 1 ||
        saved.epoch !== progressEpoch.value ||
        !Array.isArray(saved.entries) ||
        !Number.isInteger(saved.index) ||
        saved.index < 0 ||
        saved.index > saved.entries.length
      )
        return false;
      const ids = new Set<string>();
      for (const e of saved.entries) {
        if (
          !e ||
          typeof e.id !== "string" ||
          ids.has(e.id) ||
          typeof e.signature !== "string" ||
          !Array.isArray(e.optionIds) ||
          e.optionIds.length !== 4 ||
          new Set(e.optionIds).size !== 4 ||
          !e.optionIds.every((id) => ["a", "b", "c", "d"].includes(id)) ||
          !Array.isArray(e.revealed) ||
          !e.revealed.every((id) => e.optionIds.includes(id)) ||
          (e.firstCorrect !== undefined && typeof e.firstCorrect !== "boolean") ||
          e.revealed.length > 0 !== (e.firstCorrect !== undefined)
        )
          return false;
        ids.add(e.id);
      }
      entries.value = saved.entries;
      index.value = saved.index;
      reconcile();
      return true;
    } catch {
      return false;
    }
  }

  /** Keep completed showings for truthful pass totals; refresh only the future. */
  function reconcile(preserveCurrent = true) {
    const questions = byId();
    const eligible = new Set(eligibleQuestions().map((q) => q.id));
    const completed = entries.value.slice(0, index.value);
    const future = entries.value
      .slice(index.value)
      // The current showing is kept whether or not it has been answered: a
      // background sync that marks it correct from another device must not
      // yank the question the learner is looking at. Withdrawn questions
      // (absent from the bundle) still go, answered or not.
      .filter((e, offset) => questions.has(e.id) && (eligible.has(e.id) || (preserveCurrent && offset === 0)))
      .map((e) => {
        const q = questions.get(e.id)!;
        return e.signature === signature(q) ? e : makeEntries([q])[0];
      });
    const known = new Set([...completed, ...future].map((e) => e.id));
    const added = eligibleQuestions().filter((q) => !known.has(q.id));
    // Keep the currently restored showing (including revealed feedback) in
    // place, but always put unanswered questions before mistakes afterwards.
    const attempts = latest();
    const pinned =
      preserveCurrent && future[0]?.id === entries.value[index.value]?.id ? future.slice(0, 1) : [];
    const tail = [...future.slice(pinned.length), ...makeEntries(added)];
    entries.value = [
      ...completed,
      ...pinned,
      ...tail.filter((e) => !attempts.has(e.id)),
      ...tail.filter((e) => attempts.has(e.id)),
    ];
    save();
  }

  if (!restore()) restart();
  if (getCurrentScope()) watch(progressEpoch, restart, { flush: "sync" });

  const total = computed(() => entries.value.length);
  const current = computed<BundleQuestion | undefined>(() => {
    const e = entries.value[index.value];
    const q = e && byId().get(e.id);
    if (!q) return undefined;
    return { ...q, options: e.optionIds.map((id) => q.options.find((o) => o.id === id)!) };
  });
  const revealed = computed<ReadonlySet<string>>(() => new Set(entries.value[index.value]?.revealed ?? []));
  const firstCorrect = computed(() => entries.value[index.value]?.firstCorrect);
  const score = computed(() => entries.value.filter((e) => e.firstCorrect === true).length);
  const attempted = computed(() => entries.value.filter((e) => e.firstCorrect !== undefined).length);
  const skipped = computed(
    () => entries.value.slice(0, index.value).filter((e) => e.firstCorrect === undefined).length,
  );
  const remaining = computed(() => eligibleQuestions().length);

  function selectOption(optionId: string) {
    const q = current.value;
    const option = q?.options.find((o) => o.id === optionId);
    if (!q || !option) return;
    const e = entries.value[index.value];
    if (e.revealed.includes(optionId)) return;
    if (e.firstCorrect === undefined) {
      e.firstCorrect = option.correct;
      recordAttempt(q.id, q.domain, option.correct);
    }
    e.revealed.push(optionId);
    save();
  }
  function next() {
    index.value = Math.min(index.value + 1, total.value);
    reconcile(false);
  }
  return {
    current,
    index,
    total,
    revealed,
    firstCorrect,
    score,
    attempted,
    skipped,
    remaining,
    selectOption,
    next,
    restart,
  };
}

export type PracticeSession = ReturnType<typeof usePracticeSession>;
