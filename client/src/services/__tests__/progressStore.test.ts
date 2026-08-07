import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateProgressStats,
  clearProgress,
  getMistakeQuestionIds,
  getStoredAttempts,
  recordAttempt,
  resetMemoryFallback,
  saveRawAttempts,
  setSyncEnabled,
  syncFromServer,
} from "../progressStore";

describe("progressStore service", () => {
  beforeEach(() => {
    resetMemoryFallback();
  });

  afterEach(() => {
    // Never let sync state leak into an unrelated test.
    setSyncEnabled(false);
    vi.unstubAllGlobals();
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

  it("makes no network call when sync is disabled (the default)", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    recordAttempt("q-1", "domain-1", true);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to /api/attempts when sync is enabled, without throwing on a failed request", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    expect(() => recordAttempt("q-1", "domain-1", true)).not.toThrow();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/attempts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ questionId: "q-1", domain: "domain-1", correct: true }),
      }),
    );

    // Give the swallowed rejection a tick to settle; the local write must survive it.
    await Promise.resolve();
    expect(getStoredAttempts()).toHaveLength(1);
  });

  it("syncFromServer merges local and server attempts, keeping whichever attemptedAt is newer", async () => {
    const older = "2024-01-01T00:00:00.000Z";
    const newer = "2024-06-01T00:00:00.000Z";
    saveRawAttempts([
      { questionId: "q-local", domain: "domain-1", correct: true, attemptedAt: newer },
      { questionId: "q-server-newer", domain: "domain-2", correct: false, attemptedAt: older },
    ]);

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        attempts: [
          { questionId: "q-local", domain: "domain-1", correct: false, attemptedAt: older },
          { questionId: "q-server-newer", domain: "domain-2", correct: true, attemptedAt: newer },
          { questionId: "q-server-only", domain: "domain-3", correct: true, attemptedAt: newer },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    await syncFromServer();

    const merged = getStoredAttempts();
    expect(merged.find((a) => a.questionId === "q-local")?.correct).toBe(true);
    expect(merged.find((a) => a.questionId === "q-server-newer")?.correct).toBe(true);
    expect(merged.find((a) => a.questionId === "q-server-only")?.correct).toBe(true);

    // Every local questionId was already present in the server's response,
    // so no backfill POST should fire.
    const postCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(0);
  });

  it("syncFromServer backfills local-only attempts the server did not already have", async () => {
    recordAttempt("q-local-only", "domain-1", true);

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attempts: [] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    await syncFromServer();

    const postCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0][1].body).toBe(JSON.stringify({ questionId: "q-local-only", domain: "domain-1", correct: true }));
  });
});
