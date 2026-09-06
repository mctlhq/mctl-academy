import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
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
  findCourse: () => ({ mock: { domains: [{ id: "domain-1", weight: 100 }] } }),
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

  it("clearing history immediately zeroes the displayed stats", async () => {
    recordAttempt("q-1", "domain-1", true);
    const wrapper = mountDashboard();
    expect(wrapper.text()).toMatch(/1\/2/);

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await wrapper.find(".reset-progress").trigger("click");
    await nextTick();
    // clearProgress() is awaited inside the handler before the local state
    // bump; flush the microtask queue so the reactive update lands.
    await Promise.resolve();
    await nextTick();

    expect(wrapper.text()).toMatch(/0\/2/);
  });

  it("warns via window.alert when the server-side delete fails, without claiming a permanent deletion", async () => {
    recordAttempt("q-1", "domain-1", true);
    const wrapper = mountDashboard();

    setSyncEnabled(true);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    await wrapper.find(".reset-progress").trigger("click");
    await nextTick();
    await Promise.resolve();
    await nextTick();

    // Local history is gone regardless — only the server-side confirmation failed.
    expect(wrapper.text()).toMatch(/0\/2/);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toMatch(/could not confirm the server copy was deleted/i);
  });
});
