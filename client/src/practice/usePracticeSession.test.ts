import { describe, it, expect } from "vitest";
import { usePracticeSession, shuffle, type BundleQuestion } from "./usePracticeSession";

function question(id: string, overrides: Partial<BundleQuestion> = {}): BundleQuestion {
  return {
    id,
    course_id: "agentic-ai-builder",
    domain: "domain-1",
    objective: "domain-1/api-authentication",
    stem: `Stem for ${id}`,
    options: [
      { id: "a", text: "A", correct: false, explanation: "Explanation A, twelve chars min." },
      { id: "b", text: "B", correct: true, explanation: "Explanation B, twelve chars min." },
      { id: "c", text: "C", correct: false, explanation: "Explanation C, twelve chars min." },
      { id: "d", text: "D", correct: false, explanation: "Explanation D, twelve chars min." },
    ],
    ...overrides,
  };
}

// A fixed, non-identity "random" source: deterministic but not 0/1, so a
// shuffle bug that special-cases either boundary would not slip through.
function fixedRandom(sequence: number[]): () => number {
  let i = 0;
  return () => sequence[i++ % sequence.length];
}

describe("shuffle", () => {
  it("returns a permutation of the same items and does not mutate the input", () => {
    const original = [1, 2, 3, 4, 5, 6, 7, 8];
    const copy = [...original];
    const result = shuffle(original, fixedRandom([0.9, 0.1, 0.5, 0.8, 0.2, 0.6, 0.3]));

    expect(result).not.toBe(original);
    expect(original).toEqual(copy);
    expect([...result].sort()).toEqual([...original].sort());
  });

  it("actually reorders a large enough set with a non-trivial random source", () => {
    const original = Array.from({ length: 10 }, (_, i) => i);
    const result = shuffle(original, fixedRandom([0.9, 0.1, 0.7, 0.3, 0.6, 0.2, 0.8, 0.4, 0.5]));
    expect(result).not.toEqual(original);
  });
});

describe("usePracticeSession", () => {
  it("shuffles question and option order into a permutation of the loaded bundle without mutating it", () => {
    const bundle = Array.from({ length: 8 }, (_, i) => question(`q-${i}`));
    const bundleSnapshot = JSON.parse(JSON.stringify(bundle));
    const random = fixedRandom([0.9, 0.1, 0.7, 0.3, 0.6, 0.2, 0.8, 0.4, 0.5, 0.15, 0.65, 0.35]);

    const result = usePracticeSession(bundle, { random });

    expect(result.total.value).toBe(8);
    const seenIds = new Set<string>();
    const visitedOrder: string[] = [];
    for (let i = 0; i < result.total.value; i++) {
      seenIds.add(result.current.value!.id);
      visitedOrder.push(result.current.value!.id);
      // Each question's four options remain the same set, id-for-id.
      expect([...result.current.value!.options.map((o) => o.id)].sort()).toEqual(["a", "b", "c", "d"]);
      result.next();
    }
    expect(seenIds.size).toBe(8);
    expect(bundle).toEqual(bundleSnapshot);
    // A fixed, non-trivial random source over 8 items: the shuffled order
    // must differ from authored order (a no-op shuffle would be a bug, not
    // an astronomically unlikely coincidence, given this deterministic seed).
    expect(visitedOrder).not.toEqual(bundle.map((q) => q.id));
  });

  it("selectOption reveals only the selected option id for the current question", () => {
    const bundle = [question("q-1"), question("q-2")];
    const result = usePracticeSession(bundle, { random: fixedRandom([0.1, 0.2, 0.3, 0.4]) });

    result.selectOption("b");
    expect(result.revealed.value.has("b")).toBe(true);
    expect(result.revealed.value.has("a")).toBe(false);
    expect(result.revealed.value.has("c")).toBe(false);
    expect(result.revealed.value.has("d")).toBe(false);

    result.selectOption("a");
    expect(result.revealed.value.has("a")).toBe(true);
    expect(result.revealed.value.has("b")).toBe(true);
    expect(result.revealed.value.size).toBe(2);
  });

  it("resets the revealed set when moving to the next question", () => {
    const bundle = [question("q-1"), question("q-2")];
    const result = usePracticeSession(bundle, { random: fixedRandom([0.1, 0.2, 0.3, 0.4]) });

    result.selectOption("b");
    expect(result.revealed.value.size).toBe(1);

    result.next();
    expect(result.revealed.value.size).toBe(0);
  });

  it("counts score from the first selection only, per question", () => {
    const bundle = [question("q-1"), question("q-2")];
    const result = usePracticeSession(bundle, { random: fixedRandom([0.1, 0.2, 0.3, 0.4]) });

    // First question: first click is wrong ("a"), later exploring the
    // correct one ("b") must not retroactively count as correct.
    result.selectOption("a");
    result.selectOption("b");
    result.next();

    // Second question: first click is correct.
    result.selectOption("b");
    result.next();

    expect(result.current.value).toBeUndefined();
    expect(result.total.value).toBe(2);
    expect(result.attempted.value).toBe(2);
    expect(result.score.value).toBe(1);
  });
});
