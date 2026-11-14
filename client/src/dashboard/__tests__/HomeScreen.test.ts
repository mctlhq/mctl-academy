import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouterLinkStub, mount } from "@vue/test-utils";
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

// vi.mock factories are hoisted above module-level declarations.
const { catalogCourse } = vi.hoisted(() => ({
  catalogCourse: (id: string, title: string, publishedQuestionCount: number) => ({
    id,
    title,
    summary: `${title} in one sentence.`,
    publishedQuestionCount,
    available: publishedQuestionCount > 0,
    mock: { questionCount: 30, timeLimitMinutes: 60, discloseBankSize: true, domains: [] },
  }),
}));

vi.mock("../../services/courseCatalog", () => ({
  courseCatalog: [
    catalogCourse("course-alpha", "Course Alpha", 2),
    catalogCourse("course-beta", "Course Beta", 0),
  ],
  domainTitlesFor: () => ({ "domain-1": "Domain 1" }),
  findCourse: () => ({ title: "Course Alpha" }),
}));

import HomeScreen from "../HomeScreen.vue";
import CourseCard from "../../components/CourseCard.vue";
import { recordAttempt, resetMemoryFallback, setSyncEnabled } from "../../services/progressStore";

describe("HomeScreen", () => {
  beforeEach(() => {
    resetMemoryFallback();
    setSyncEnabled(false);
  });

  it("refreshes stats when a background sync bumps syncVersion, without remounting", async () => {
    const syncVersion = ref(0);
    const wrapper = mount(HomeScreen, {
      global: { stubs: { RouterLink: RouterLinkStub }, provide: { syncVersion } },
    });

    expect(wrapper.text()).toMatch(/Start practice/);

    recordAttempt("q-1", "domain-1", true);
    syncVersion.value += 1;
    await nextTick();

    expect(wrapper.text()).toMatch(/Continue practice/);
    expect(wrapper.text()).toMatch(/1 of 2 questions solved/);
  });

  function mountHome() {
    return mount(HomeScreen, {
      global: { stubs: { RouterLink: RouterLinkStub }, provide: { syncVersion: ref(0) } },
    });
  }

  it("introduces the course on a first visit and points to the mock as a secondary option", () => {
    const wrapper = mountHome();
    expect(wrapper.find(".next-course").text()).toBe("Course Alpha");
    expect(wrapper.text()).toMatch(/2 questions, one at a time/);
    expect(wrapper.findAllComponents(RouterLinkStub).map((l) => l.props("to"))).toContain("/mock");
  });

  it("links each domain to a filtered Practice", () => {
    const wrapper = mountHome();
    const link = wrapper.find(".domain-bar-link");
    expect(link.text()).toContain("Domain 1");
    expect(wrapper.findAllComponents(RouterLinkStub).map((l) => l.props("to"))).toContain(
      "/practice?domain=domain-1",
    );
  });

  it("states zero mistakes as a neutral line rather than a success card", () => {
    recordAttempt("q-1", "domain-1", true);
    const wrapper = mountHome();
    expect(wrapper.find(".mistakes-clear").text()).toContain("No mistakes waiting for review");
    expect(wrapper.text()).not.toMatch(/Keep going/);
    expect(wrapper.find(".mistakes-callout").exists()).toBe(false);
  });

  it("navigates with links: the next-step CTA and the mistakes callout", () => {
    recordAttempt("q-1", "domain-1", false);
    const wrapper = mountHome();
    const targets = wrapper.findAllComponents(RouterLinkStub).map((l) => l.props("to"));
    expect(targets).toContain("/practice");
    expect(targets).toContain("/mistakes");
    expect(wrapper.find(".next-card button").exists()).toBe(false);
    expect(wrapper.find(".home-summary button").exists()).toBe(false);
  });

  it("lists every catalog course as a card, coming-soon ones included", () => {
    const wrapper = mountHome();
    const cards = wrapper.findAllComponents(CourseCard);
    expect(cards.map((c) => c.attributes("data-course-id"))).toEqual(["course-alpha", "course-beta"]);

    const [alpha, beta] = cards;
    expect(alpha.text()).toContain("Course Alpha in one sentence.");
    expect(alpha.text()).toContain("Available");
    expect(alpha.text()).toContain("Studying now");
    const alphaLinks = alpha.findAllComponents(RouterLinkStub).map((l) => l.props("to"));
    expect(alphaLinks).toEqual(["/practice?course=course-alpha", "/courses/course-alpha"]);

    // No published questions: listed, but Practice cannot start an empty bank.
    expect(beta.text()).toContain("Coming soon");
    expect(beta.text()).not.toContain("Studying now");
    expect(beta.get("button").attributes()).toHaveProperty("disabled");
    expect(beta.findAllComponents(RouterLinkStub).map((l) => l.props("to"))).toEqual([
      "/courses/course-beta",
    ]);
  });
});
