import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import PracticeView from "../PracticeView.vue";
import CourseView from "../CourseView.vue";
import { PRACTICE_DESCRIPTION, practiceHeadMeta } from "../../seo/courseMeta.mjs";

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

describe("PracticeView description and social meta", () => {
  const HOME_DESC = "Home description";
  const HOME_TITLE = "Home title";
  const desc = () => document.querySelector('meta[name="description"]')?.getAttribute("content");
  const ogTitle = () => document.querySelector('meta[property="og:title"]')?.getAttribute("content");
  const canonical = () => document.querySelector('link[rel="canonical"]')?.getAttribute("href");

  function headAsServed(path: "/" | "/practice") {
    // What server/spa.mjs sends: on /practice every rewritten tag keeps the
    // site default in data-default.
    const practice = practiceHeadMeta();
    const tag = (el: string, value: string, home: string) =>
      path === "/practice"
        ? el
            .replace("VALUE", value)
            .replace("<meta ", `<meta data-default="${home}" `)
            .replace("<link ", `<link data-default="${home}" `)
        : el.replace("VALUE", home);
    document.head.innerHTML = [
      tag('<meta name="description" content="VALUE" />', practice.description, HOME_DESC),
      tag('<meta property="og:title" content="VALUE" />', practice.title, HOME_TITLE),
      tag('<link rel="canonical" href="VALUE" />', practice.canonicalUrl, "https://academy.mctl.ai/"),
    ].join("");
  }

  it("sets the practice description and social title, then restores the home values", () => {
    headAsServed("/");
    const wrapper = mountPracticeView();
    expect(desc()).toBe(PRACTICE_DESCRIPTION);
    expect(ogTitle()).toBe("Practice · mctl academy");
    wrapper.unmount();
    expect(desc()).toBe(HOME_DESC);
    expect(ogTitle()).toBe(HOME_TITLE);
  });

  it("after a server-rendered /practice, leaving restores the site defaults, not the practice values", () => {
    headAsServed("/practice");
    const wrapper = mountPracticeView();
    wrapper.unmount();
    expect(desc()).toBe(HOME_DESC);
    expect(ogTitle()).toBe(HOME_TITLE);
    expect(canonical()).toBe("https://academy.mctl.ai/");
  });

  it("a server-rendered /practice followed by a course page restores the site defaults on leaving the course", () => {
    headAsServed("/practice");
    mountPracticeView().unmount();
    const course = mountCourseView();
    expect(canonical()).toBe("https://academy.mctl.ai/courses/agentic-ai-builder");
    course.unmount();
    expect(desc()).toBe(HOME_DESC);
    expect(canonical()).toBe("https://academy.mctl.ai/");
  });
});
