import { describe, expect, it } from "vitest";
import { selectMockQuestions } from "../selectMockQuestions";
import type { MockConfig, Question } from "../types";
import bundle from "../../data/mock-bundle.generated.json";

function makeQuestion(id: string, domain: string): Question {
  return {
    id,
    domain,
    objective: `${domain}/obj`,
    stem: `Stem ${id}`,
    options: [
      { id: "a", text: "A", correct: true, explanation: "exp a" },
      { id: "b", text: "B", correct: false, explanation: "exp b" },
      { id: "c", text: "C", correct: false, explanation: "exp c" },
      { id: "d", text: "D", correct: false, explanation: "exp d" },
    ],
  };
}

const config: MockConfig = {
  questionCount: 30,
  timeLimitMinutes: 60,
  discloseBankSize: true,
  domains: [
    { id: "domain-1", title: "D1", weight: 20, mockQuestions: 6 },
    { id: "domain-2", title: "D2", weight: 35, mockQuestions: 10 },
    { id: "domain-3", title: "D3", weight: 20, mockQuestions: 6 },
    { id: "domain-4", title: "D4", weight: 25, mockQuestions: 8 },
  ],
};

function bankWithCounts(counts: Record<string, number>): Question[] {
  const questions: Question[] = [];
  for (const [domain, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      questions.push(makeQuestion(`${domain}-q${i}`, domain));
    }
  }
  return questions;
}

describe("selectMockQuestions", () => {
  it("T1: returns exactly 6/10/6/8 per domain (30 total) when each domain has enough", () => {
    const bank = bankWithCounts({ "domain-1": 8, "domain-2": 12, "domain-3": 8, "domain-4": 10 });
    const result = selectMockQuestions(bank, config, () => 0.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions).toHaveLength(30);
    for (const domain of config.domains) {
      expect(result.questions.filter((q) => q.domain === domain.id)).toHaveLength(domain.mockQuestions);
    }
  });

  it("returns a typed shortfall, not a throw or a silent short mock, when a domain is short", () => {
    const bank = bankWithCounts({ "domain-1": 2, "domain-2": 12, "domain-3": 8, "domain-4": 10 });
    const result = selectMockQuestions(bank, config, () => 0.5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.shortfall).toEqual([{ domain: "domain-1", needed: 6, available: 2 }]);
  });

  it("randomizes selection across repeated calls (not deterministically the same 30)", () => {
    const bank = bankWithCounts({ "domain-1": 20, "domain-2": 20, "domain-3": 20, "domain-4": 20 });
    const first = selectMockQuestions(bank, config, Math.random);
    const second = selectMockQuestions(bank, config, Math.random);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.questions.map((q) => q.id).sort()).not.toEqual(second.questions.map((q) => q.id).sort());
  });

  it("T2: exercised against the real current bank, proves the bank now satisfies 6/10/6/8 requirements", () => {
    const result = selectMockQuestions(bundle.questions as Question[], bundle.mock as MockConfig);
    // Now that the question bank has grown past the Phase 1 target of 80 items
    // (with at least 6/10/6/8 in each domain), mock selection succeeds cleanly.
    expect(result.ok).toBe(true);
  });
});
