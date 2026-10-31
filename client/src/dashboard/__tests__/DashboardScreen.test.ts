import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";

vi.mock("../../services/courseStore", () => ({
  useCourseStore: () => ({ currentCourseId: ref("course-alpha") }),
}));

vi.mock("../../services/contentBundle", () => ({
  questionsForCourse: () => [
    { id: "q-1", domain: "domain-1" },
    { id: "q-2", domain: "domain-1" },
  ],
}));

vi.mock("../../services/courseCatalog", () => ({
  domainTitlesFor: () => ({ "domain-1": "Domain 1" }),
  findCourse: () => ({ title: "Course Alpha", mock: { domains: [{ id: "domain-1", weight: 100 }] } }),
}));

import DashboardScreen from "../DashboardScreen.vue";
import { recordAttempt, resetMemoryFallback, setSyncEnabled } from "../../services/progressStore";

function mountDashboard(syncVersion = ref(0)) {
  return mount(DashboardScreen, {
    props: { onReviewMistakes: () => {}, onStartPractice: () => {} },
    global: { provide: { syncVersion } },
  });
}

describe("DashboardScreen", () => {
  beforeEach(() => {
    resetMemoryFallback();
    setSyncEnabled(false);
  });

  it("refreshes stats when a background sync bumps syncVersion, without remounting", async () => {
    const syncVersion = ref(0);
    const wrapper = mountDashboard(syncVersion);

    expect(wrapper.text()).toMatch(/0\/2/); // 0 attempted of 2

    // Simulate App.vue's syncFromServer() merging in progress from the
    // server after this screen already mounted — this must update the
    // numbers in place, exactly like AppNav's mistake badge does.
    recordAttempt("q-1", "domain-1", true);
    syncVersion.value += 1;
    await nextTick();

    expect(wrapper.text()).toMatch(/1\/2/);
  });

  async function confirmClear(wrapper: ReturnType<typeof mountDashboard>) {
    await wrapper.find(".reset-progress").trigger("click");
    await nextTick();
    const confirm = document.body.querySelector<HTMLButtonElement>(".confirm-submit");
    expect(confirm).not.toBeNull();
    confirm!.click();
    await flushPromises();
  }

  it("names the all-courses scope before clearing, and cancel changes nothing", async () => {
    recordAttempt("q-1", "domain-1", true);
    const wrapper = mountDashboard();

    expect(wrapper.find(".reset-progress").text()).toMatch(/all courses/i);
    await wrapper.find(".reset-progress").trigger("click");
    await nextTick();
    expect(document.body.textContent).toMatch(/every course/i);
    expect(document.body.textContent).toMatch(/cannot be undone/i);

    const cancel = [...document.body.querySelectorAll<HTMLButtonElement>(".m-modal button")].find(
      (b) => b.textContent?.trim() === "Cancel",
    );
    cancel!.click();
    await flushPromises();

    expect(wrapper.text()).toMatch(/1\/2/);
    expect(document.body.querySelector(".confirm-submit")).toBeNull();
    wrapper.unmount();
  });

  it("clearing history immediately zeroes the displayed stats", async () => {
    recordAttempt("q-1", "domain-1", true);
    const wrapper = mountDashboard();
    expect(wrapper.text()).toMatch(/1\/2/);

    await confirmClear(wrapper);

    expect(wrapper.text()).toMatch(/0\/2/);
    expect(wrapper.text()).toMatch(/History cleared for all courses/);
    wrapper.unmount();
  });

  it("warns inline with a retry when the server-side delete fails, without claiming a permanent deletion", async () => {
    recordAttempt("q-1", "domain-1", true);
    const wrapper = mountDashboard();

    setSyncEnabled(true);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    await confirmClear(wrapper);

    // Local history is gone regardless — only the server-side confirmation failed.
    expect(wrapper.text()).toMatch(/0\/2/);
    expect(wrapper.text()).toMatch(/could not confirm the server copy was deleted/i);
    expect(wrapper.text()).not.toMatch(/History cleared for all courses/);

    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    const retry = wrapper.findAll("button").find((b) => b.text().includes("Retry server deletion"));
    await retry!.trigger("click");
    await flushPromises();

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/attempts",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(wrapper.text()).toMatch(/History cleared for all courses/);
    vi.unstubAllGlobals();
    wrapper.unmount();
  });
});
