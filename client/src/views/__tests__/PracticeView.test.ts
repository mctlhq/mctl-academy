import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import PracticeView from "../PracticeView.vue";
import CourseView from "../CourseView.vue";

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => ({
    params: { courseId: "agentic-ai-builder" },
    query: {},
  }),
}));

vi.mock("../../services/courseStore", () => ({
  useCourseStore: () => ({
    setCourse: vi.fn().mockReturnValue(true),
    currentCourseId: ref("agentic-ai-builder"),
  }),
}));

function mountPracticeView() {
  return mount(PracticeView, {
    global: {
      provide: {
        currentUser: ref(null),
        syncVersion: ref(0),
      },
      stubs: {
        PracticeContent: { template: '<div data-testid="practice-content" />' },
        RouterLink: { template: "<a><slot /></a>" },
      },
    },
  });
}

function mountCourseView() {
  return mount(CourseView, {
    global: {
      stubs: {
        RouterLink: { template: "<a><slot /></a>" },
      },
    },
  });
}

describe("PracticeView canonical & og:url meta lifecycle", () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <title>Default Title</title>
      <meta property="og:url" content="https://academy.mctl.ai/" />
      <link rel="canonical" href="https://academy.mctl.ai/" />
    `;
  });

  it("updates canonical and og:url on mount and restores on unmount", () => {
    const wrapper = mountPracticeView();
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://academy.mctl.ai/practice",
    );
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(
      "https://academy.mctl.ai/practice",
    );

    wrapper.unmount();
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://academy.mctl.ai/",
    );
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(
      "https://academy.mctl.ai/",
    );
  });

  it("transitions from CourseView to PracticeView without reverting canonical to site root", async () => {
    const courseWrapper = mountCourseView();
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://academy.mctl.ai/courses/agentic-ai-builder",
    );
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(
      "https://academy.mctl.ai/courses/agentic-ai-builder",
    );

    // Transition: CourseView unmounts, PracticeView mounts
    courseWrapper.unmount();
    const practiceWrapper = mountPracticeView();

    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://academy.mctl.ai/practice",
    );
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(
      "https://academy.mctl.ai/practice",
    );

    practiceWrapper.unmount();
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://academy.mctl.ai/",
    );
  });

  it("transitions from PracticeView to CourseView correctly", async () => {
    const practiceWrapper = mountPracticeView();
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://academy.mctl.ai/practice",
    );

    practiceWrapper.unmount();
    const courseWrapper = mountCourseView();

    expect(document.querySelector('link[rel="canonical"]')?.getAttribute("href")).toBe(
      "https://academy.mctl.ai/courses/agentic-ai-builder",
    );
    courseWrapper.unmount();
  });
});
