import { beforeEach, describe, expect, it } from "vitest";
import {
  calculateProgressStats,
  clearProgress,
  getMistakeQuestionIds,
  getStoredAttempts,
  recordAttempt,
  resetMemoryFallback,
} from "../progressStore";

describe("progressStore service", () => {
  beforeEach(() => {
    resetMemoryFallback();
  });

  it("stores and retrieves question attempts", () => {
    expect(getStoredAttempts()).toEqual([]);

    recordAttempt("q-1", "domain-1", true);
    recordAttempt("q-2", "domain-1", false);

    const attempts = getStoredAttempts();
    expect(attempts).toHaveLength(2);
    expect(attempts.find((a) => a.questionId === "q-1")?.correct).toBe(true);
    expect(attempts.find((a) => a.questionId === "q-2")?.correct).toBe(false);
  });

  it("identifies uncorrected mistakes", () => {
    recordAttempt("q-1", "domain-1", false);
    recordAttempt("q-2", "domain-2", true);
    recordAttempt("q-3", "domain-3", false);

    expect(getMistakeQuestionIds()).toEqual(["q-1", "q-3"]);

    // Correcting q-1 removes it from mistakes list
    recordAttempt("q-1", "domain-1", true);
    expect(getMistakeQuestionIds()).toEqual(["q-3"]);
  });

  it("calculates domain-by-domain and overall progress statistics", () => {
    const mockBundle = [
      { id: "q-1", domain: "domain-1" },
      { id: "q-2", domain: "domain-1" },
      { id: "q-3", domain: "domain-2" },
      { id: "q-4", domain: "domain-2" },
    ];

    recordAttempt("q-1", "domain-1", true);
    recordAttempt("q-2", "domain-1", false);
    recordAttempt("q-3", "domain-2", true);

    const stats = calculateProgressStats(mockBundle);

    expect(stats.totalBankQuestions).toBe(4);
    expect(stats.totalAttempted).toBe(3);
    expect(stats.totalCorrect).toBe(2);
    expect(stats.overallAccuracy).toBe(67); // 2/3 = ~67%
    expect(stats.totalMistakes).toBe(1);

    const domain1 = stats.domainProgress.find((d) => d.domainId === "domain-1");
    expect(domain1).toBeDefined();
    expect(domain1?.attemptedQuestions).toBe(2);
    expect(domain1?.correctQuestions).toBe(1);
    expect(domain1?.accuracy).toBe(50);

    const domain2 = stats.domainProgress.find((d) => d.domainId === "domain-2");
    expect(domain2).toBeDefined();
    expect(domain2?.attemptedQuestions).toBe(1);
    expect(domain2?.correctQuestions).toBe(1);
    expect(domain2?.accuracy).toBe(100);
  });

  it("clears progress history", () => {
    recordAttempt("q-1", "domain-1", true);
    expect(getStoredAttempts()).toHaveLength(1);

    clearProgress();
    expect(getStoredAttempts()).toEqual([]);
  });
});
