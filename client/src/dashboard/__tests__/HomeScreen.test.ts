import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouterLinkStub, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick, ref } from "vue";

// vi.mock factories are hoisted above module-level declarations.
const { currentCourseId, catalogCourse } = vi.hoisted(() => ({
  currentCourseId: { value: "course-alpha" },
  catalogCourse: (id: string, title: string, publishedQuestionCount: number, mockQuestionCount = 30) => ({
    id,
    title,
    summary: `${title} in one sentence.`,
    publishedQuestionCount,
    available: publishedQuestionCount > 0,
    mock: { questionCount: mockQuestionCount, timeLimitMinutes: 60, discloseBankSize: true, domains: [] },
  }),
}));

const { bank } = vi.hoisted(() => ({
  bank: [
    {
      id: "q-1",
      course_id: "course-alpha",
      domain: "domain-1",
      sources: [
        { title: "A", url: "https://docs.example/a", excerpt: "a" },
        { title: "B", url: "https://docs.example/b", excerpt: "b" },
      ],
    },
    {
      id: "q-2",
      course_id: "course-alpha",
      domain: "domain-1",
      sources: [{ title: "A again", url: "https://docs.example/a", excerpt: "a2" }],
    },
    {
      id: "q-3",
      course_id: "course-gamma",
      domain: "domain-1",
      sources: [{ title: "C", url: "https://docs.example/c", excerpt: "c" }],
    },
  ],
}));

vi.mock("../../services/courseStore", async () => {
  const { ref: vueRef } = await import("vue");
  const id = vueRef(currentCourseId.value);
  return {
    useCourseStore: () => {
      id.value = currentCourseId.value;
      return { currentCourseId: id };
    },
  };
});

vi.mock("../../services/contentBundle", () => ({
  allQuestions: bank,
  questionsForCourse: (id: string) => bank.filter((q) => q.course_id === id),
}));

vi.mock("../../services/courseCatalog", () => {
  const courses = [
    catalogCourse("course-alpha", "Course Alpha", 2),
    catalogCourse("course-beta", "Course Beta", 0),
    catalogCourse("course-gamma", "Course Gamma", 1, 1),
  ];
  return {
    courseCatalog: courses,
    domainTitlesFor: () => ({ "domain-1": "Domain 1" }),
    findCourse: (id: string) => courses.find((c) => c.id === id),
  };
});

import HomeScreen from "../HomeScreen.vue";
import CourseCard from "../../components/CourseCard.vue";
import { recordAttempt, resetMemoryFallback, setSyncEnabled } from "../../services/progressStore";

function mountHome(syncVersion = ref(0)) {
  return mount(HomeScreen, {
    global: { stubs: { RouterLink: RouterLinkStub }, provide: { syncVersion } },
  });
}

function linkTargets(wrapper: ReturnType<typeof mountHome>) {
  return wrapper.findAllComponents(RouterLinkStub).map((l) => l.props("to"));
}

describe("HomeScreen", () => {
  beforeEach(() => {
    resetMemoryFallback();
    setSyncEnabled(false);
    currentCourseId.value = "course-alpha";
  });

  it("opens on the catalog, not on the selected course's dashboard", () => {
    const wrapper = mountHome();
    expect(wrapper.find("h1").text()).toMatch(/Practice questions/);
    // The per-course progress widgets live on /dashboard only.
    expect(wrapper.find(".domain-bar-link").exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/Progress by domain|Recommended next step|Streak/);
    expect(wrapper.find(".home-continue").exists()).toBe(false);
  });

  it("names the course the primary action opens", () => {
    const wrapper = mountHome();
    const cta = wrapper.get(".home-cta");
    expect(cta.text()).toContain("Start practicing: Course Alpha");
    expect(
      cta.findAllComponents(RouterLinkStub).map((l: VueWrapper) => (l.props() as { to: unknown }).to),
    ).toEqual(["/practice?course=course-alpha"]);
  });

  it("falls back to the first available course when the selected one has no bank", () => {
    currentCourseId.value = "course-beta";
    const wrapper = mountHome();
    expect(wrapper.find(".home-cta").text()).toContain("Start practicing: Course Alpha");
  });

  it("derives the facts row from the catalog and the bundle", () => {
    const facts = mountHome()
      .findAll(".home-facts div")
      .map((d) => [d.get("dt").text(), d.get("dd").text()]);
    expect(facts).toEqual([
      ["Courses available", "2"],
      ["Published questions", "3"],
      // a, b and c: the repeated URL counts once.
      ["Documentation pages cited", "3"],
    ]);
  });

  it("switches to continue once the selected course has attempts, refreshing on syncVersion", async () => {
    const syncVersion = ref(0);
    const wrapper = mountHome(syncVersion);

    recordAttempt("q-1", "domain-1", true);
    syncVersion.value += 1;
    await nextTick();

    expect(wrapper.find(".home-cta").text()).toContain("Continue: Course Alpha");
    const strip = wrapper.get(".home-continue");
    expect(strip.text()).toContain("1 of 2 solved");
    expect(strip.text()).toContain("0 to review");
    expect(linkTargets(wrapper)).toContain("/dashboard");
  });

  it("splits the catalog into available and coming-soon grids", () => {
    const wrapper = mountHome();
    const grids = wrapper.findAll(".home-courses");
    expect(grids).toHaveLength(2);
    const ids = grids.map((g) =>
      g.findAllComponents(CourseCard).map((c: VueWrapper) => c.attributes("data-course-id")),
    );
    expect(ids).toEqual([["course-alpha", "course-gamma"], ["course-beta"]]);
  });

  it("marks a bank smaller than one mock as early access, and the selected course", () => {
    const cards = mountHome().findAllComponents(CourseCard);
    const byId = Object.fromEntries(cards.map((c) => [c.attributes("data-course-id"), c.text()]));

    expect(byId["course-alpha"]).toContain("Early access");
    expect(byId["course-alpha"]).toContain("Selected");
    // One published question fills a one-question mock: no longer early access.
    expect(byId["course-gamma"]).toContain("Available");
    expect(byId["course-gamma"]).not.toContain("Early access");
    expect(byId["course-gamma"]).not.toContain("Selected");
    expect(byId["course-beta"]).toContain("Coming soon");
  });
});
