import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectScope, ref, type EffectScope } from "vue";
import { practiceStorageKey, usePracticeSession } from "./usePracticeSession";
import type { BundleQuestion } from "../services/contentBundle";
import {
  calculateProgressStats,
  clearProgress,
  getStoredAttempts,
  recordAttempt,
  resetMemoryFallback,
  setSyncEnabled,
} from "../services/progressStore";
import { setItem } from "../services/storage";

const q = (id: string): BundleQuestion => ({
  id,
  course_id: "course",
  domain: "domain-1",
  objective: "domain-1/topic",
  stem: id,
  options: (["a", "b", "c", "d"] as const).map((id) => ({
    id,
    text: id,
    correct: id === "b",
    explanation: `Explanation ${id}`,
  })),
});
const scopes: EffectScope[] = [];
const start = (bundle: Parameters<typeof usePracticeSession>[0], overrides = {}) => {
  const scope = effectScope();
  scopes.push(scope);
  return scope.run(() =>
    usePracticeSession(bundle, {
      mode: "remaining",
      storageKey: "test-queue",
      random: () => 0.999,
      ...overrides,
    }),
  )!;
};
beforeEach(() => {
  resetMemoryFallback();
  setSyncEnabled(false);
});
afterEach(() => {
  scopes.splice(0).forEach((s) => s.stop());
});

describe("persistent remaining-question practice", () => {
  it("shows all unseen questions first, then mistakes, and excludes solved questions", () => {
    recordAttempt("solved", "domain-1", true);
    recordAttempt("wrong", "domain-1", false);
    const s = start([q("wrong"), q("solved"), q("new1"), q("new2"), q("new3")]);
    const ids = [];
    while (s.current.value) {
      ids.push(s.current.value.id);
      s.next();
    }
    expect(ids).toEqual(["new1", "new2", "new3", "wrong"]);
    expect(s.attempted.value).toBe(0);
    expect(s.skipped.value).toBe(4);
    expect(getStoredAttempts()).toHaveLength(2);
  });
  it("restores the same question, option order and feedback without recording another attempt", () => {
    const bundle = [q("one"), q("two")];
    const s = start(bundle);
    s.next();
    s.selectOption("a");
    s.selectOption("b");
    const restored = start(bundle, { random: () => 0 });
    expect(restored.index.value).toBe(1);
    expect(restored.current.value).toEqual(s.current.value);
    expect([...restored.revealed.value]).toEqual(["a", "b"]);
    expect(restored.score.value).toBe(0);
    restored.selectOption("c");
    expect(getStoredAttempts()).toHaveLength(1);
  });
  it("counts only a fresh first answer as success and returns later Mock mistakes", () => {
    const s = start([q("one")]);
    s.selectOption("a");
    s.selectOption("b");
    s.next();
    expect(s.remaining.value).toBe(1);
    s.restart();
    s.selectOption("b");
    s.next();
    expect(s.remaining.value).toBe(0);
    recordAttempt("one", "domain-1", false);
    s.restart();
    expect(s.current.value?.id).toBe("one");
  });
  it("keeps a correct answer's feedback when returning before Next", () => {
    const s = start([q("one")]);
    s.selectOption("b");
    const restored = start([q("one")]);
    expect(restored.current.value?.id).toBe("one");
    expect(restored.revealed.value.has("b")).toBe(true);
    restored.next();
    expect(restored.current.value).toBeUndefined();
  });
  it("does not jump on external progress, but removes solved future questions on Next", () => {
    const s = start([q("one"), q("two"), q("three")]);
    recordAttempt("two", "domain-1", true);
    expect(s.current.value?.id).toBe("one");
    s.next();
    expect(s.current.value?.id).toBe("three");
  });
  it("removes withdrawn current questions and appends newly published unseen questions before mistakes", () => {
    recordAttempt("wrong", "domain-1", false);
    start([q("removed"), q("wrong")]);
    const s = start([q("new"), q("wrong")]);
    // No surviving current question to pin after withdrawal.
    expect(s.current.value?.id).toBe("new");
    s.next();
    expect(s.current.value?.id).toBe("wrong");
  });
  it("prioritizes newly added unseen questions at the next boundary", () => {
    const bundle = ref([q("one"), q("wrong")]);
    recordAttempt("wrong", "domain-1", false);
    const s = start(bundle);
    bundle.value.push(q("new"));
    s.next();
    expect(s.current.value?.id).toBe("new");
  });
  it("does not repeat skipped or incorrect questions until an explicit new pass", () => {
    const s = start([q("one"), q("two")]);
    s.next();
    s.selectOption("a");
    s.next();
    expect(s.current.value).toBeUndefined();
    expect(s.remaining.value).toBe(2);
    s.restart();
    expect(s.current.value?.id).toBe("one");
  });
  it("restores completed passes without silently replaying mistakes", () => {
    const s = start([q("one")]);
    s.selectOption("a");
    s.next();
    expect(start([q("one")]).current.value).toBeUndefined();
  });
  it("ignores corrupt persisted state and invalid selections", () => {
    setItem("test-queue", '{"version":1,"epoch":"0","index":-1,"entries":[]}');
    const s = start([q("one")]);
    s.selectOption("invalid");
    expect(s.current.value?.id).toBe("one");
    expect(getStoredAttempts()).toHaveLength(0);
  });
  it("resets feedback when question wording changes", () => {
    const s = start([q("one")]);
    s.selectOption("a");
    expect(start([{ ...q("one"), stem: "Updated question" }]).revealed.value.size).toBe(0);
  });
  it("resets stored cursors when the learner clears history", async () => {
    const s = start([q("one"), q("two")]);
    s.selectOption("b");
    s.next();
    await clearProgress();
    expect(s.current.value?.id).toBe("one");
    expect(start([q("one"), q("two")]).index.value).toBe(0);
  });
  it("isolates queue keys by account, course, mode and domain", () => {
    const keys = [
      practiceStorageKey(null, "c", "remaining"),
      practiceStorageKey("u", "c", "remaining"),
      practiceStorageKey("v", "c", "remaining"),
      practiceStorageKey("u", "d", "remaining"),
      practiceStorageKey("u", "c", "all"),
      practiceStorageKey("u", "c", "remaining", "domain-1"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    start([q("one"), q("two")], { storageKey: keys[1] }).next();
    expect(start([q("one"), q("two")], { storageKey: keys[2] }).index.value).toBe(0);
    expect(start([q("one"), q("two")], { storageKey: keys[1] }).index.value).toBe(1);
  });
  it("supports mistakes-only and repeat-all independently of solved status", () => {
    recordAttempt("wrong", "domain-1", false);
    recordAttempt("solved", "domain-1", true);
    const bank = [q("new"), q("wrong"), q("solved")];
    expect(start(bank, { mode: "mistakes", storageKey: "mistakes" }).total.value).toBe(1);
    expect(start(bank, { mode: "all", storageKey: "all" }).total.value).toBe(3);
  });
  it("computes solved fraction against the bank and remains reactive", () => {
    const bank = Array.from({ length: 16 }, (_, i) => q(`q${i}`));
    const s = start(bank);
    for (let i = 0; i < 5; i++) recordAttempt(`q${i}`, "domain-1", true);
    expect(calculateProgressStats(bank)).toMatchObject({
      totalUnseen: 11,
      totalCorrect: 5,
      solvedPercent: 31,
      overallAccuracy: 100,
    });
    expect(s.remaining.value).toBe(11);
    recordAttempt("q0", "domain-1", false);
    expect(calculateProgressStats(bank)).toMatchObject({
      totalUnseen: 11,
      totalCorrect: 4,
      solvedPercent: 25,
      overallAccuracy: 80,
    });
  });
});
