import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getItem, setItem } from "../storage";
import {
  calculateProgressStats,
  calculateStudyStreak,
  clearProgress,
  getMistakeQuestionIds,
  getStoredAttempts,
  recordAttempt,
  resetMemoryFallback,
  saveRawAttempts,
  setProgressOwner,
  setSyncEnabled,
  syncFromServer,
  syncStatus,
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

    recordAttempt("q-1", "domain-1", true, "a");
    recordAttempt("q-2", "domain-1", false, "b");

    const attempts = getStoredAttempts();
    expect(attempts).toHaveLength(2);
    expect(attempts.find((a) => a.questionId === "q-1")?.correct).toBe(true);
    expect(attempts.find((a) => a.questionId === "q-2")?.correct).toBe(false);
  });

  it("identifies uncorrected mistakes", () => {
    recordAttempt("q-1", "domain-1", false, "b");
    recordAttempt("q-2", "domain-2", true, "a");
    recordAttempt("q-3", "domain-3", false, "b");

    expect(getMistakeQuestionIds()).toEqual(["q-1", "q-3"]);

    // Correcting q-1 removes it from mistakes list
    recordAttempt("q-1", "domain-1", true, "a");
    expect(getMistakeQuestionIds()).toEqual(["q-3"]);
  });

  it("keeps prior attempts on a retry instead of erasing them (attempts are append-only)", () => {
    recordAttempt("q-1", "domain-1", false, "b");
    recordAttempt("q-1", "domain-1", true, "a");

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

    recordAttempt("q-1", "domain-1", true, "a");
    recordAttempt("q-2", "domain-1", false, "b");
    recordAttempt("q-3", "domain-2", true, "a");

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

    recordAttempt("q-1", "domain-1", true, "a");
    recordAttempt("q-2", "domain-1", false, "b");
    recordAttempt("other-course-q-1", "domain-1", false, "b");
    recordAttempt("other-course-q-2", "domain-2", false, "b");

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
    recordAttempt("q-1", "domain-1", true, "a");
    expect(getStoredAttempts()).toHaveLength(1);

    clearProgress();
    expect(getStoredAttempts()).toEqual([]);
  });

  it("clearProgress makes no server call when sync is disabled, and reports the server as clear", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    recordAttempt("q-1", "domain-1", true, "a");
    const result = await clearProgress();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ serverCleared: true });
    expect(getStoredAttempts()).toEqual([]);
  });

  it("clearProgress deletes server attempts for a signed-in learner", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    recordAttempt("q-1", "domain-1", true, "a");
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
    recordAttempt("q-1", "domain-1", true, "a");
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
    recordAttempt("q-1", "domain-1", true, "a");
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
    saveRawAttempts([
      { questionId: "q-1", domain: "domain-1", correct: true, attemptedAt: staleAttemptedAt },
    ]);

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
    recordAttempt("q-1", "domain-1", true, "a"); // fires the POST, not awaited

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

  it("a fast-resolving clearProgress does not release the lock for a still-in-flight overlapping clearProgress (double-click)", async () => {
    // Two overlapping clearProgress() calls, e.g. from a double-clicked
    // button: the first call's DELETE resolves quickly, the second's is
    // still pending. The first call's `finally` must not null out the lock
    // the second call still owns — otherwise a sync racing in right after
    // the first resolves would slip through and merge stale data.
    let resolveSecondDelete!: (value: unknown) => void;
    const secondDeletePromise = new Promise((resolve) => {
      resolveSecondDelete = resolve;
    });
    let deleteCallCount = 0;
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleteCallCount += 1;
        return deleteCallCount === 1 ? Promise.resolve({ ok: true }) : secondDeletePromise;
      }
      return Promise.resolve({ ok: true, json: async () => ({ attempts: [] }) });
    });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    const firstClear = clearProgress();
    const secondClear = clearProgress();

    const firstResult = await firstClear; // resolves while the second is still pending
    expect(firstResult).toEqual({ serverCleared: true });

    // The lock must still be held by the second, unresolved clearProgress().
    const callsBeforeSync = fetchSpy.mock.calls.length;
    await syncFromServer(); // must still bail out — no GET issued
    expect(fetchSpy.mock.calls.length).toBe(callsBeforeSync);

    resolveSecondDelete({ ok: true });
    await secondClear;
  });

  it("clearProgress holds back an answer recorded while it waits for pending writes until after the DELETE", async () => {
    // A learner answers a question while clearProgress() is still awaiting
    // the writes that predate it. That answer is post-clear data: its POST
    // must not be sent before the DELETE (which would erase it on the
    // server while the device marks it synced), only after it.
    const callOrder: string[] = [];
    let resolveFirstPost!: (value: unknown) => void;
    const firstPostPromise = new Promise((resolve) => {
      resolveFirstPost = resolve;
    });
    let resolveSecondPost!: (value: unknown) => void;
    const secondPostPromise = new Promise((resolve) => {
      resolveSecondPost = resolve;
    });
    let postCallCount = 0;

    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postCallCount += 1;
        const callNumber = postCallCount;
        callOrder.push(`POST-${callNumber}-start`);
        const promise = callNumber === 1 ? firstPostPromise : secondPostPromise;
        return promise.then((value) => {
          callOrder.push(`POST-${callNumber}-resolve`);
          return value;
        });
      }
      callOrder.push("DELETE");
      return Promise.resolve({ ok: true });
    });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    recordAttempt("q-1", "domain-1", true, "a"); // first pending write

    const clearPromise = clearProgress();
    await Promise.resolve();
    await Promise.resolve();
    expect(callOrder).toContain("POST-1-start");
    expect(callOrder).not.toContain("DELETE");

    // A second answer arrives while clearProgress() is still awaiting the
    // first write's snapshot.
    recordAttempt("q-2", "domain-1", false, "b");
    resolveFirstPost({ ok: true });

    await vi.waitFor(() => expect(callOrder).toContain("POST-2-start"));
    resolveSecondPost({ ok: true });
    await clearPromise;

    expect(callOrder).toEqual(["POST-1-start", "POST-1-resolve", "DELETE", "POST-2-start", "POST-2-resolve"]);
    expect(getStoredAttempts()).toEqual([expect.objectContaining({ questionId: "q-2", synced: true })]);
    expect(syncStatus.value).toBe("synced");
  });

  it("does not send an answer recorded during the DELETE until the DELETE has resolved (#397)", async () => {
    const callOrder: string[] = [];
    let resolveDelete!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        callOrder.push(init?.method ?? "GET");
        if (init?.method === "DELETE") return new Promise((resolve) => (resolveDelete = resolve));
        return Promise.resolve({ ok: true, json: async () => ({ attempts: [] }) });
      }),
    );
    setSyncEnabled(true);
    const clearing = clearProgress();
    await vi.waitFor(() => expect(resolveDelete).toBeTypeOf("function"));

    recordAttempt("q-1", "domain-1", true, "a"); // answered while the DELETE is in flight
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(callOrder).toEqual(["DELETE"]);

    resolveDelete({ ok: true });
    await clearing;
    expect(callOrder).toEqual(["DELETE", "POST"]);
    expect(syncStatus.value).toBe("synced");
  });

  it("drops an answer held back by a clear when another clear wipes it, and never sends it on another account", async () => {
    const posts: string[] = [];
    const deletes: Array<(value: unknown) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") return new Promise((resolve) => deletes.push(resolve));
        if (init?.method === "POST") posts.push(JSON.parse(String(init.body)).questionId);
        return Promise.resolve({ ok: true, json: async () => ({ attempts: [] }) });
      }),
    );
    setSyncEnabled(true);
    const first = clearProgress();
    await vi.waitFor(() => expect(deletes).toHaveLength(1));
    recordAttempt("q-wiped", "domain-1", true, "a");
    const second = clearProgress(); // wipes q-wiped locally
    await vi.waitFor(() => expect(deletes).toHaveLength(2));
    recordAttempt("q-other-account", "domain-1", true, "a");
    setSyncEnabled(true); // account change while the DELETEs are in flight
    deletes.forEach((resolve) => resolve({ ok: true }));
    await Promise.all([first, second]);
    expect(posts).toEqual([]);
  });

  it("makes no network call when sync is disabled (the default)", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    recordAttempt("q-1", "domain-1", true, "a");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to /api/attempts when sync is enabled, without throwing on a failed request", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    expect(() => recordAttempt("q-1", "domain-1", true, "a")).not.toThrow();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/attempts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ questionId: "q-1", optionId: "a" }),
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
    recordAttempt("q-1", "domain-1", true, "a");

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(Object.keys(body).sort()).toEqual(["optionId", "questionId"]);
    expect(body).not.toHaveProperty("courseId");

    // Nor is it kept locally, where a later sync would have to reconcile it.
    expect(getStoredAttempts()[0]).not.toHaveProperty("courseId");
  });

  it("backfill posts carry no course association either", async () => {
    recordAttempt("q-local-only", "domain-1", true, "a");

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ attempts: [] }) });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    await syncFromServer();

    const postCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(1);
    expect(Object.keys(JSON.parse(postCalls[0][1].body)).sort()).toEqual(["optionId", "questionId"]);
  });

  it("sends the chosen option, never a correctness boolean or domain (#208)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    setSyncEnabled(true);
    recordAttempt("q-1", "domain-1", false, "c");
    recordAttempt("q-2", "domain-1", false, null); // a Mock exam question left unanswered

    const bodies = fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies).toEqual([
      { questionId: "q-1", optionId: "c" },
      { questionId: "q-2", optionId: null },
    ]);
  });

  it("does not backfill a pre-#208 row that has no recorded option, and does not report it as a failure", async () => {
    saveRawAttempts([
      { questionId: "q-legacy", domain: "domain-1", correct: true, attemptedAt: "2026-09-01T00:00:00Z" },
    ]);
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ attempts: [] }) });
    vi.stubGlobal("fetch", fetchSpy);
    setSyncEnabled(true);

    expect(await syncFromServer()).toBe("synced");
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    // The row stays on this device: local progress is unchanged.
    expect(getStoredAttempts()).toEqual([expect.objectContaining({ questionId: "q-legacy", correct: true })]);
  });

  describe("a POST the server refuses for good (400/422)", () => {
    /** GET returns no server rows; every POST answers with `postStatus`. */
    function stubServer(postStatus: number) {
      const fetchSpy = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === "POST"
            ? { ok: postStatus >= 200 && postStatus < 300, status: postStatus }
            : { ok: true, status: 200, json: async () => ({ attempts: [] }) },
        ),
      );
      vi.stubGlobal("fetch", fetchSpy);
      return () => fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST").length;
    }

    it.each([400, 422])(
      "a backfilled row refused with %i becomes local-only: no failure, never re-posted",
      async (status) => {
        // e.g. its question file was deleted, so the server answers unknown_question.
        saveRawAttempts([
          {
            questionId: "q-deleted",
            domain: "domain-1",
            correct: true,
            attemptedAt: "2026-09-01T00:00:00Z",
            optionId: "a",
          },
        ]);
        const posts = stubServer(status);
        setSyncEnabled(true);

        expect(await syncFromServer()).toBe("synced");
        expect(syncStatus.value).toBe("synced");
        expect(posts()).toBe(1);

        // The next syncs leave it alone, and it still counts as local progress.
        expect(await syncFromServer()).toBe("synced");
        expect(await syncFromServer()).toBe("synced");
        expect(posts()).toBe(1);
        expect(getStoredAttempts()).toEqual([
          expect.objectContaining({ questionId: "q-deleted", correct: true, serverRejected: true }),
        ]);
      },
    );

    it("a live answer refused with 400 does not flip the status to failed, and is not backfilled later", async () => {
      const posts = stubServer(400);
      setSyncEnabled(true);
      expect(await syncFromServer()).toBe("synced");

      recordAttempt("q-deleted", "domain-1", true, "a");
      await vi.waitFor(() =>
        expect(getStoredAttempts()).toEqual([expect.objectContaining({ serverRejected: true })]),
      );
      expect(syncStatus.value).toBe("synced");

      expect(await syncFromServer()).toBe("synced");
      expect(posts()).toBe(1);
    });

    it("a clear does not report failed because an answer recorded mid-clear was refused", async () => {
      let releaseFirst!: () => void;
      let posts = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          if (init?.method === "POST") {
            posts += 1;
            if (posts === 1)
              return new Promise((resolve) => (releaseFirst = () => resolve({ ok: true, status: 201 })));
            return Promise.resolve({ ok: false, status: 400 });
          }
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ attempts: [] }) });
        }),
      );
      setSyncEnabled(true);
      recordAttempt("q-1", "domain-1", true, "a"); // POST in flight
      const clearing = clearProgress(); // waits for it
      recordAttempt("q-deleted", "domain-1", false, "b"); // recorded after the local wipe; refused
      releaseFirst();
      await clearing;
      expect(getStoredAttempts()).toEqual([
        expect.objectContaining({ questionId: "q-deleted", serverRejected: true }),
      ]);
      expect(syncStatus.value).toBe("synced");
    });

    it.each([
      ["a 500", 500],
      ["a 503", 503],
      ["a 401", 401],
      ["a 403", 403],
      ["a 429", 429],
    ])("keeps retrying a row after %s, and reports the sync as failed", async (_label, status) => {
      recordAttempt("q-1", "domain-1", true, "a");
      const posts = stubServer(status);
      setSyncEnabled(true);

      expect(await syncFromServer()).toBe("failed");
      expect(await syncFromServer()).toBe("failed");
      expect(posts()).toBe(2);
      expect(getStoredAttempts()[0]).not.toHaveProperty("serverRejected");
    });

    it("keeps retrying a row after a network error", async () => {
      recordAttempt("q-1", "domain-1", true, "a");
      const fetchSpy = vi.fn((_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? Promise.reject(new Error("offline"))
          : Promise.resolve({ ok: true, status: 200, json: async () => ({ attempts: [] }) }),
      );
      vi.stubGlobal("fetch", fetchSpy);
      setSyncEnabled(true);

      expect(await syncFromServer()).toBe("failed");
      expect(await syncFromServer()).toBe("failed");
      expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
      expect(getStoredAttempts()[0]).not.toHaveProperty("serverRejected");
    });
  });

  it("syncFromServer reconciles local and server attempts without deleting either side's history", async () => {
    const older = "2024-01-01T00:00:00.000Z";
    const newer = "2024-06-01T00:00:00.000Z";
    saveRawAttempts([
      { questionId: "q-local", domain: "domain-1", correct: true, attemptedAt: newer, optionId: "a" },
      { questionId: "q-server-newer", domain: "domain-2", correct: false, attemptedAt: older, optionId: "b" },
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
    expect(postCalls[0][1].body).toBe(JSON.stringify({ questionId: "q-local", optionId: "a" }));
  });

  it("does not re-post a backfilled attempt forever when the local clock is skewed ahead of the server", async () => {
    // Local clock is skewed into the future relative to the server.
    recordAttempt("q-skewed", "domain-1", true, "a");
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
        attempts: [
          { questionId: "q-skewed", domain: "domain-1", correct: true, attemptedAt: serverAttemptedAt },
        ],
      }),
    });

    await syncFromServer();
    await syncFromServer();
    await syncFromServer();

    postCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(1);
  });

  it("syncFromServer backfills local-only attempts the server did not already have", async () => {
    recordAttempt("q-local-only", "domain-1", true, "a");

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ attempts: [] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    setSyncEnabled(true);
    await syncFromServer();

    const postCalls = fetchSpy.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0][1].body).toBe(JSON.stringify({ questionId: "q-local-only", optionId: "a" }));
  });

  describe("sync status", () => {
    it("is off while sync is disabled and never claims synced", async () => {
      expect(syncStatus.value).toBe("off");
      expect(await syncFromServer()).toBe("disabled");
      expect(syncStatus.value).toBe("off");
    });

    it("reports failed, not synced, when the server read fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
      setSyncEnabled(true);
      expect(await syncFromServer()).toBe("failed");
      expect(syncStatus.value).toBe("failed");
    });

    it("treats a body without an attempts array as a failed read, not an empty history", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
      setSyncEnabled(true);
      expect(await syncFromServer()).toBe("failed");
      expect(syncStatus.value).toBe("failed");
    });

    it("reports failed when a backfill write is rejected", async () => {
      recordAttempt("q-local", "domain-1", true, "a");
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) =>
          Promise.resolve(
            init?.method === "POST"
              ? { ok: false, status: 500 }
              : { ok: true, json: async () => ({ attempts: [] }) },
          ),
        ),
      );
      setSyncEnabled(true);
      expect(await syncFromServer()).toBe("failed");
      expect(syncStatus.value).toBe("failed");
    });

    it("reports synced only after the read and every backfill write succeed", async () => {
      recordAttempt("q-local", "domain-1", true, "a");
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) =>
          Promise.resolve(
            init?.method === "POST" ? { ok: true } : { ok: true, json: async () => ({ attempts: [] }) },
          ),
        ),
      );
      setSyncEnabled(true);
      expect(await syncFromServer()).toBe("synced");
      expect(syncStatus.value).toBe("synced");
    });

    it("drops a status update from a previous account's request", async () => {
      let resolveGet!: (value: unknown) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise((resolve) => (resolveGet = resolve))),
      );
      setSyncEnabled(true); // account A
      const pending = syncFromServer();
      setSyncEnabled(false); // signed out before A's read came back
      resolveGet({ ok: false, status: 500 });
      await pending;
      expect(syncStatus.value).toBe("off");
    });

    it("settles a sync that deferred to a clear, using the clear's own result", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ attempts: [] }) }));
      setSyncEnabled(true);
      const clearing = clearProgress();
      expect(await syncFromServer()).toBe("deferred");
      await clearing;
      expect(syncStatus.value).toBe("synced");
    });

    it("lets a clear that starts during backfill writes own the status", async () => {
      recordAttempt("q-local", "domain-1", true, "a");
      let releasePost!: () => void;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          if (init?.method === "POST")
            return new Promise((resolve) => (releasePost = () => resolve({ ok: true })));
          if (init?.method === "DELETE") return Promise.resolve({ ok: false, status: 500 });
          return Promise.resolve({ ok: true, json: async () => ({ attempts: [] }) });
        }),
      );
      setSyncEnabled(true);
      const syncing = syncFromServer();
      await vi.waitFor(() => expect(releasePost).toBeTypeOf("function"));
      const clearing = clearProgress(); // waits for the backfill, then DELETE fails
      releasePost();
      expect(await syncing).toBe("deferred");
      await clearing;
      expect(syncStatus.value).toBe("failed");
    });

    it("does not report synced after a clear while an answer recorded mid-clear failed to upload", async () => {
      let releaseFirst!: () => void;
      let posts = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          if (init?.method === "POST") {
            posts += 1;
            if (posts === 1) return new Promise((resolve) => (releaseFirst = () => resolve({ ok: true })));
            return Promise.reject(new Error("offline"));
          }
          return Promise.resolve({ ok: true, json: async () => ({ attempts: [] }) });
        }),
      );
      setSyncEnabled(true);
      recordAttempt("q-1", "domain-1", true, "a"); // POST in flight
      const clearing = clearProgress(); // waits for it
      recordAttempt("q-2", "domain-1", false, "b"); // recorded after the local wipe; its POST fails
      releaseFirst();
      await clearing;
      expect(getStoredAttempts().map((a) => a.questionId)).toEqual(["q-2"]);
      expect(syncStatus.value).toBe("failed");
    });

    it("waits for an answer still uploading when the clear finishes instead of reporting failed", async () => {
      let releaseDelete!: () => void;
      let releasePost!: () => void;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          if (init?.method === "DELETE")
            return new Promise((resolve) => (releaseDelete = () => resolve({ ok: true })));
          if (init?.method === "POST")
            return new Promise((resolve) => (releasePost = () => resolve({ ok: true })));
          return Promise.resolve({ ok: true, json: async () => ({ attempts: [] }) });
        }),
      );
      setSyncEnabled(true);
      const clearing = clearProgress();
      await vi.waitFor(() => expect(releaseDelete).toBeTypeOf("function"));
      recordAttempt("q-1", "domain-1", true, "a"); // answered while the DELETE is in flight
      releaseDelete();
      await vi.waitFor(() => expect(releasePost).toBeTypeOf("function"));
      releasePost();
      await clearing;
      expect(syncStatus.value).toBe("synced");
    });

    it("reports failed when the server copy could not be cleared", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
      setSyncEnabled(true);
      await clearProgress();
      expect(syncStatus.value).toBe("failed");
    });

    it("downgrades to failed when a later attempt write fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ attempts: [] }) }));
      setSyncEnabled(true);
      expect(await syncFromServer()).toBe("synced");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
      recordAttempt("q-1", "domain-1", true, "a");
      await vi.waitFor(() => expect(syncStatus.value).toBe("failed"));
      // The answer itself is kept locally regardless.
      expect(getStoredAttempts()).toHaveLength(1);
    });
  });
});

describe("progress log per owner (#403)", () => {
  beforeEach(() => {
    resetMemoryFallback();
  });

  afterEach(() => {
    setSyncEnabled(false);
    vi.unstubAllGlobals();
  });

  const ids = () => getStoredAttempts().map((a) => a.questionId);

  function stubServer(posts: string[], postOk: () => boolean) {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)).questionId);
          return Promise.resolve({ ok: postOk() });
        }
        return Promise.resolve({ ok: true, json: async () => ({ attempts: [] }) });
      }),
    );
  }

  it("does not show an account's history to the guest after sign-out, nor to the next account", async () => {
    const posts: string[] = [];
    let online = false;
    stubServer(posts, () => online);

    setProgressOwner("user-a");
    setSyncEnabled(true);
    recordAttempt("q-a", "domain-1", false, "b"); // its POST fails: unsynced
    await vi.waitFor(() => expect(posts).toEqual(["q-a"]));

    setProgressOwner(null);
    setSyncEnabled(false);
    expect(ids()).toEqual([]);

    online = true;
    posts.length = 0;
    setProgressOwner("user-b");
    setSyncEnabled(true);
    await syncFromServer();
    expect(ids()).toEqual([]);
    expect(posts).toEqual([]); // A's unsynced answer is never uploaded into B

    setProgressOwner("user-a");
    expect(ids()).toEqual(["q-a"]); // still on this device for A
  });

  it("adopts guest answers into the account that signs in, once, and backfills them", async () => {
    const posts: string[] = [];
    stubServer(posts, () => true);
    recordAttempt("q-guest", "domain-1", true, "a");

    setProgressOwner("user-a");
    setSyncEnabled(true);
    expect(ids()).toEqual(["q-guest"]);
    expect(await syncFromServer()).toBe("synced");
    expect(posts).toEqual(["q-guest"]);

    setProgressOwner(null);
    setSyncEnabled(false);
    expect(ids()).toEqual([]);
    setProgressOwner("user-b");
    expect(ids()).toEqual([]);
  });

  it("does not merge or backfill a read that settles after the account changed", async () => {
    const posts: string[] = [];
    let resolveGet!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)).questionId);
          return Promise.resolve({ ok: true });
        }
        return new Promise((resolve) => (resolveGet = resolve));
      }),
    );
    setProgressOwner("user-a");
    saveRawAttempts([
      {
        questionId: "q-a",
        domain: "domain-1",
        correct: true,
        attemptedAt: "2026-09-01T00:00:00Z",
        optionId: "a",
      },
    ]);
    setSyncEnabled(true);
    const pending = syncFromServer();
    await vi.waitFor(() => expect(resolveGet).toBeTypeOf("function"));

    setProgressOwner("user-b");
    setSyncEnabled(true);
    resolveGet({
      ok: true,
      json: async () => ({
        attempts: [
          {
            questionId: "q-server-a",
            domain: "domain-1",
            correct: true,
            attemptedAt: "2026-09-02T00:00:00Z",
          },
        ],
      }),
    });
    expect(await pending).toBe("deferred");
    expect(posts).toEqual([]);
    expect(ids()).toEqual([]);
  });

  it("keeps a POST that settles after an account switch on the log it was recorded in", async () => {
    let resolvePost!: (value: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => (resolvePost = resolve))),
    );
    setProgressOwner("user-a");
    setSyncEnabled(true);
    recordAttempt("q-a", "domain-1", true, "a");
    setProgressOwner("user-b");
    setSyncEnabled(true);
    resolvePost({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0)); // the POST settles while B is signed in
    expect(ids()).toEqual([]);
    setProgressOwner("user-a");
    expect(getStoredAttempts()).toEqual([expect.objectContaining({ questionId: "q-a", synced: true })]);
  });

  it("clear history erases only the signed-in account's log", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ attempts: [] }) }));
    recordAttempt("q-guest", "domain-1", true, "a");
    setProgressOwner("user-a");
    setProgressOwner(null);
    recordAttempt("q-guest-2", "domain-1", true, "a");
    setProgressOwner("user-b");
    setSyncEnabled(true);
    await clearProgress();
    expect(ids()).toEqual([]);
    setProgressOwner("user-a");
    expect(ids()).toEqual(["q-guest"]);
  });

  it("migrates the pre-#403 shared log: unsynced rows become guest rows, synced rows are dropped", async () => {
    setItem(
      "mctl_academy_progress_v1",
      JSON.stringify([
        {
          questionId: "q-synced",
          domain: "domain-1",
          correct: true,
          attemptedAt: "2026-09-01T00:00:00Z",
          synced: true,
        },
        { questionId: "q-offline", domain: "domain-1", correct: false, attemptedAt: "2026-09-01T00:00:00Z" },
      ]),
    );
    setProgressOwner(null);
    expect(ids()).toEqual(["q-offline"]);
    expect(getItem("mctl_academy_progress_v1")).toBeNull();
    setProgressOwner(null); // idempotent
    expect(ids()).toEqual(["q-offline"]);
  });
});
