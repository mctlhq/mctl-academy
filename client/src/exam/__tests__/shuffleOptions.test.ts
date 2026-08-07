import { describe, expect, it } from "vitest";
import { shuffleOptions } from "../shuffleOptions";
import type { Question } from "../types";

const question: Question = {
  id: "q-1",
  domain: "domain-1",
  objective: "domain-1/obj",
  stem: "Stem",
  options: [
    { id: "a", text: "A", correct: false, explanation: "exp a" },
    { id: "b", text: "B", correct: true, explanation: "exp b" },
    { id: "c", text: "C", correct: false, explanation: "exp c" },
    { id: "d", text: "D", correct: false, explanation: "exp d" },
  ],
};

describe("shuffleOptions", () => {
  it("T3: keeps all 4 options present exactly once, with correct/explanation traveling with the original text", () => {
    const shuffled = shuffleOptions(question, () => 0.99);
    expect(shuffled.options).toHaveLength(4);
    expect(new Set(shuffled.options.map((o) => o.id))).toEqual(new Set(["a", "b", "c", "d"]));
    for (const original of question.options) {
      expect(shuffled.options.find((o) => o.id === original.id)).toEqual(original);
    }
  });

  it("does not mutate the input question", () => {
    const before = JSON.stringify(question);
    shuffleOptions(question, () => 0.99);
    expect(JSON.stringify(question)).toEqual(before);
  });
});
