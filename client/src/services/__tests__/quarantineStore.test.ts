import { describe, it, expect, vi, beforeEach } from "vitest";
import { useQuarantineStore } from "../quarantineStore";

describe("useQuarantineStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches quarantined question IDs and checks quarantine status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, quarantinedQuestionIds: ["q-quarantined-1"] }),
    } as unknown as Response);

    const store = useQuarantineStore();
    const ids = await store.fetchQuarantinedIds();

    expect(ids.has("q-quarantined-1")).toBe(true);
    expect(store.isQuarantined("q-quarantined-1")).toBe(true);
    expect(store.isQuarantined("q-clean-1")).toBe(false);
  });
});
