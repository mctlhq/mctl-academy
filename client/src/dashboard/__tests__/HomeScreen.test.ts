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
}));

import HomeScreen from "../HomeScreen.vue";
import { recordAttempt, resetMemoryFallback, setSyncEnabled } from "../../services/progressStore";

describe("HomeScreen", () => {
  beforeEach(() => {
    resetMemoryFallback();
    setSyncEnabled(false);
  });

  it("refreshes stats when a background sync bumps syncVersion, without remounting", async () => {
    const syncVersion = ref(0);
    const wrapper = mount(HomeScreen, {
      props: { onStartPractice: () => {}, onReviewMistakes: () => {} },
      global: { provide: { syncVersion } },
    });

    expect(wrapper.text()).toMatch(/Start practice/);

    recordAttempt("q-1", "domain-1", true);
    syncVersion.value += 1;
    await nextTick();

    expect(wrapper.text()).toMatch(/Continue practice/);
    expect(wrapper.text()).toMatch(/1 of 2 questions solved/);
  });
});
