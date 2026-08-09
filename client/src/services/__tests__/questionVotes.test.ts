import { afterEach, describe, expect, it, vi } from "vitest";
import { castVote, fetchVoteSummary, removeVote } from "../questionVotes";

describe("questionVotes service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the vote summary for a question with same-origin credentials", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ score: 3, userValue: 1 }) });
    vi.stubGlobal("fetch", fetchSpy);

    const summary = await fetchVoteSummary("q-1");

    expect(fetchSpy).toHaveBeenCalledWith("/api/votes/q-1", expect.objectContaining({ credentials: "same-origin" }));
    expect(summary).toEqual({ score: 3, userValue: 1 });
  });

  it("URL-encodes the question id in the request path", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ score: 0, userValue: 0 }) });
    vi.stubGlobal("fetch", fetchSpy);

    await fetchVoteSummary("q/with special?chars");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/votes/q%2Fwith%20special%3Fchars",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("casts an upvote via PUT with the value in the JSON body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ score: 1, userValue: 1 }) });
    vi.stubGlobal("fetch", fetchSpy);

    const summary = await castVote("q-1", 1);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/votes/q-1",
      expect.objectContaining({
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: 1 }),
      }),
    );
    expect(summary).toEqual({ score: 1, userValue: 1 });
  });

  it("casts a downvote via PUT with -1", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ score: -1, userValue: -1 }) });
    vi.stubGlobal("fetch", fetchSpy);

    await castVote("q-1", -1);

    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ value: -1 });
  });

  it("removes a vote via DELETE", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ score: 0, userValue: 0 }) });
    vi.stubGlobal("fetch", fetchSpy);

    const summary = await removeVote("q-1");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/votes/q-1",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );
    expect(summary).toEqual({ score: 0, userValue: 0 });
  });

  it("throws on a non-ok response instead of returning a fabricated summary", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchVoteSummary("q-1")).rejects.toThrow(/401/);
  });

  it("propagates a network failure instead of swallowing it", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(castVote("q-1", 1)).rejects.toThrow("offline");
  });
});
