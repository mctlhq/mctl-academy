import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateProgressStats,
  calculateStudyStreak,
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

  it("keeps prior attempts on a retry instead of erasing them (attempts are append-only)", () => {
    recordAttempt("q-1", "domain-1", false);
    recordAttempt("q-1", "domain-1", true);

    const attempts = getStoredAttempts();
    expect(attempts).toHaveLength(2);
    expect(attempts.map((a) => a.correct)).toEqual([false, true]);

    // Mistakes/stats still reflect only the *current* (latest) state.
    expect(getMistakeQuestionIds()).toEqual([]);
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

  it("scopes every statistic to the bundle it is given, ignoring other courses' attempts", () => {
    // The bundle is the course scope. Attempts recorded against another
    // course's questions match no id here, so they cannot inflate the
    // denominator, the accuracy, or the open-mistake count.
    const courseBundle = [
      { id: "q-1", domain: "domain-1" },
      { id: "q-2", domain: "domain-1" },
    ];

    recordAttempt("q-1", "domain-1", true);
    recordAttempt("q-2", "domain-1", false);
    recordAttempt("other-course-q-1", "domain-1", false);
    recordAttempt("other-course-q-2", "domain-2", false);

    const stats = calculateProgressStats(courseBundle);

    expect(stats.totalBankQuestions).toBe(2);
    expect(stats.totalAttempted).toBe(2);
    expect(stats.totalCorrect).toBe(1);
    expect(stats.totalMistakes).toBe(1);
    expect(stats.domainProgress.map((d) => d.domainId)).toEqual(["domain-1"]);
  });

  it("labels domains from the titles it is given, not a hardcoded map", () => {
    const stats = calculateProgressStats([{ id: "q-1", domain: "domain-1" }], [], {
      "domain-1": "Cloud Infrastructure",
    });
    expect(stats.domainProgress[0].domainTitle).toBe("Cloud Infrastructure");
  });

  it("calculates a consecutive study streak ending today or yesterday", () => {
    const now = new Date("2026-08-08T12:00:00.000Z");
    const attempts = [
      { questionId: "q-1", domain: "domain-1", correct: true, attemptedAt: "2026-08-08T09:00:00.000Z" },
      { questionId: "q-2", domain: "domain-1", correct: true, attemptedAt: "2026-08-07T18:00:00.000Z" },
      { questionId: "q-3", domain: "domain-2", correct: false, attemptedAt: "2026-08-06T08:00:00.000Z" },
      { questionId: "q-4", domain: "domain-2", correct: true, attemptedAt: "2026-08-04T08:00:00.000Z" },
    ];

    expect(calculateStudyStreak(attempts, now)).toBe(3);
    expect(
      calculateStudyStreak(
        attempts.filter((attempt) => !attempt.attemptedAt.startsWith("2026-08-08")),
        now,
      ),
    ).toBe(2);
  });

  it("clears progress history", () => {
    recordAttempt("q-1", "domain-1", true);
    expect(getStoredAttempts()).toHaveLength(1);

    clearProgress();
    expect(getStoredAttempts()).toEqual([]);
  });

  it("clearProgress makes no server call when sync is disabled, and reports the server as clear", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    recordAttempt("q-1", "domain-1", true);
    const result = await clearProgress();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ serverCleared: true });
    expect(getStoredAttempts()).toEqual([]);
  });

  it("clearProgress deletes server attempts for a signed-in learner", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    recordAttempt("q-1", "domain-1", true);
    const result = await clearProgress();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/attempts",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );
    expect(result).toEqual({ serverCleared: true });
    expect(getStoredAttempts()).toEqual([]);
  });

  it("clearProgress reports serverCleared: false when the server delete fails, without losing the local clear", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    recordAttempt("q-1", "domain-1", true);
    const result = await clearProgress();

    expect(result).toEqual({ serverCleared: false });
    // Local history is still gone even though the server call failed — the
    // caller is responsible for telling the learner it isn't permanent yet.
    expect(getStoredAttempts()).toEqual([]);
  });

  it("clearProgress reports serverCleared: false on a network error", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    recordAttempt("q-1", "domain-1", true);
    const result = await clearProgress();

    expect(result).toEqual({ serverCleared: false });
  });

  it("a sync already in flight when history is cleared does not resurrect the pre-clear data", async () => {
    // The GET was issued (and its response captured) before the learner hit
    // "Clear history" — the stale server rows must not be written back in
    // once that response finally resolves.
    let resolveGet!: (value: unknown) => void;
    const getPromise = new Promise((resolve) => {
      resolveGet = resolve;
    });
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Promise.resolve({ ok: true });
      }
      return getPromise;
    });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    // Comfortably in the past relative to whenever clearProgress() below
    // sets its marker, regardless of test-runner clock granularity.
    const staleAttemptedAt = new Date(Date.now() - 60_000).toISOString();
    saveRawAttempts([{ questionId: "q-1", domain: "domain-1", correct: true, attemptedAt: staleAttemptedAt }]);

    const syncPromise = syncFromServer(); // GET in flight, not yet resolved
    const { serverCleared } = await clearProgress(); // clears local + DELETE
    expect(serverCleared).toBe(true);
    expect(getStoredAttempts()).toEqual([]);

    // Now the stale GET resolves, carrying the pre-clear row — timestamped
    // before the clear, same as it would be for real (the server had not
    // yet processed the DELETE, or never even received this POST's data
    // past what it already had, when this GET was issued).
    resolveGet({
      ok: true,
      json: async () => ({
        attempts: [{ questionId: "q-1", domain: "domain-1", correct: true, attemptedAt: staleAttemptedAt }],
      }),
    });
    await syncPromise;

    expect(getStoredAttempts()).toEqual([]);
  });

  it("clearProgress waits for a pending recordAttempt POST before deleting server attempts, so a late write cannot resurrect it", async () => {
    // recordAttempt's POST is fire-and-forget: it can still be in flight when
    // the learner hits "Clear history". If the DELETE fired first, that POST
    // landing afterwards would recreate the very row being cleared. Assert
    // the actual wire order: the pending POST must settle before the DELETE
    // is ever issued.
    const callOrder: string[] = [];
    let resolvePost!: (value: unknown) => void;
    const postPromise = new Promise((resolve) => {
      resolvePost = resolve;
    });

    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      if (!init || init.method === undefined) {
        callOrder.push("GET");
        return Promise.resolve({ ok: true, json: async () => ({ attempts: [] }) });
      }
      if (init.method === "POST") {
        callOrder.push("POST-start");
        return postPromise.then((value) => {
          callOrder.push("POST-resolve");
          return value;
        });
      }
      callOrder.push("DELETE");
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    recordAttempt("q-1", "domain-1", true); // fires the POST, not awaited

    const clearPromise = clearProgress();

    // Flush pending microtasks without letting the still-unresolved POST
    // settle — the DELETE must not have been issued yet.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(callOrder).toEqual(["POST-start"]);

    resolvePost({ ok: true });
    const { serverCleared } = await clearPromise;

    expect(serverCleared).toBe(true);
    expect(callOrder).toEqual(["POST-start", "POST-resolve", "DELETE"]);
  });

  it("syncFromServer does not start a GET while a clear is in flight", async () => {
    const callOrder: string[] = [];
    let resolveDelete!: (value: unknown) => void;
    const deletePromise = new Promise((resolve) => {
      resolveDelete = resolve;
    });

    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        callOrder.push("DELETE-start");
        return deletePromise;
      }
      callOrder.push("GET");
      return Promise.resolve({ ok: true, json: async () => ({ attempts: [] }) });
    });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    const clearPromise = clearProgress(); // DELETE in flight, not yet resolved
    await Promise.resolve();
    await Promise.resolve();

    await syncFromServer(); // must bail out before ever calling fetch for GET

    expect(callOrder).toEqual(["DELETE-start"]);

    resolveDelete({ ok: true });
    await clearPromise;
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

  it("never transmits a course association with an attempt", () => {
    // Course membership is content metadata derivable from questionId. Sending
    // it would duplicate content as personal learner data, so the POST body is
    // pinned to exactly the three permitted fields.
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    recordAttempt("q-1", "domain-1", true);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(["correct", "domain", "questionId"]);
    expect(body).not.toHaveProperty("courseId");

    // Nor is it kept locally, where a later sync would have to reconcile it.
    expect(getStoredAttempts()[0]).not.toHaveProperty("courseId");
  });

  it("backfill posts carry no course association either", async () => {
    recordAttempt("q-local-only", "domain-1", true);

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ attempts: [] }) });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    await syncFromServer();

    const postCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(1);
    expect(Object.keys(JSON.parse(postCalls[0][1].body)).sort()).toEqual([
      "correct",
      "domain",
      "questionId",
    ]);
  });

  it("syncFromServer reconciles local and server attempts without deleting either side's history", async () => {
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

    // The log is append-only: the original local rows are still there
    // (nothing was deleted), plus whatever the server knew that this
    // device's log didn't already have at least as recent.
    const merged = getStoredAttempts();
    const currentState = new Map(merged.map((a) => [a.questionId, a] as const));
    for (const a of merged) {
      const existing = currentState.get(a.questionId)!;
      if (new Date(a.attemptedAt).getTime() >= new Date(existing.attemptedAt).getTime()) {
        currentState.set(a.questionId, a);
      }
    }
    expect(currentState.get("q-local")?.correct).toBe(true);
    expect(currentState.get("q-server-newer")?.correct).toBe(true);
    expect(currentState.get("q-server-only")?.correct).toBe(true);

    // q-local's server record was stale (older, correct: false) relative to
    // this device's newer local record — that must be backfilled, even
    // though the server already had *some* record for the question. Only
    // q-server-newer's server record was already at least as recent, so it
    // is the one questionId that must NOT be re-posted.
    const postCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0][1].body).toBe(
      JSON.stringify({ questionId: "q-local", domain: "domain-1", correct: true }),
    );
  });

  it("does not re-post a backfilled attempt forever when the local clock is skewed ahead of the server", async () => {
    // Local clock is skewed into the future relative to the server.
    recordAttempt("q-skewed", "domain-1", true);
    const [stored] = getStoredAttempts();
    const skewedFutureAttemptedAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    saveRawAttempts([{ ...stored, attemptedAt: skewedFutureAttemptedAt }]);

    // The server stamps the row with its own (real, "earlier") clock on
    // insert — which will never catch up to the skewed local timestamp.
    const serverAttemptedAt = new Date().toISOString();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attempts: [] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);

    await syncFromServer();
    let postCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Now the server has a record too, permanently older than the skewed
    // local timestamp — the naive "is server up to date" comparison would
    // stay false forever and repost on every subsequent sync.
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        attempts: [{ questionId: "q-skewed", domain: "domain-1", correct: true, attemptedAt: serverAttemptedAt }],
      }),
    });

    await syncFromServer();
    await syncFromServer();
    await syncFromServer();

    postCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(1);
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
