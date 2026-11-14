import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import CourseView from "../CourseView.vue";
import * as courseCatalogModule from "../../services/courseCatalog";

const mockSetCourse = vi.fn().mockReturnValue(true);
// Reactive so a test can change the route param under a mounted view, the way
// vue-router does when /courses/X -> /courses/Y reuses the component.
let currentRouteParams = reactive({ courseId: "agentic-ai-builder" });

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => ({
    params: currentRouteParams,
  }),
}));

vi.mock("../../services/courseStore", () => ({
  useCourseStore: () => ({
    setCourse: mockSetCourse,
  }),
}));

function mountCourseView() {
  return mount(CourseView, {
    global: {
      stubs: {
        RouterLink: {
          name: "RouterLink",
          props: ["to"],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  });
}

describe("CourseView", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mockSetCourse.mockReturnValue(true);
    currentRouteParams = reactive({ courseId: "agentic-ai-builder" });
    document.head.innerHTML = `
      <title>Original Title</title>
      <meta name="description" content="Original Description" />
      <meta property="og:title" content="Original OG Title" />
      <meta property="og:description" content="Original OG Description" />
      <meta property="og:url" content="https://academy.mctl.ai/" />
      <link rel="canonical" href="https://academy.mctl.ai/" />
    `;
    document.title = "Original Title";
  });

  it("renders the course hero and selects the course it shows", () => {
    const wrapper = mountCourseView();
    expect(wrapper.text()).toContain("Agentic AI Builder");
    expect(wrapper.text()).toContain("Practice track");
    expect(wrapper.text()).toContain("Practice domains & syllabus");
    // The header switcher reads the store: without this the page showed one
    // course while the header named another.
    expect(mockSetCourse).toHaveBeenCalledWith("agentic-ai-builder");
  });

  it("re-selects when the route moves to another course page", async () => {
    mountCourseView();
    mockSetCourse.mockClear();
    currentRouteParams.courseId = "agentic-web-search";
    await nextTick();
    expect(mockSetCourse).toHaveBeenCalledWith("agentic-web-search");
  });

  it("does not select a coming-soon or unknown course", () => {
    vi.spyOn(courseCatalogModule, "findCourse").mockReturnValue({
      id: "upcoming-course",
      title: "Upcoming Track",
      publishedQuestionCount: 0,
      available: false,
      mock: { questionCount: 30, timeLimitMinutes: 60, discloseBankSize: true, domains: [] },
    });
    mountCourseView().unmount();
    vi.spyOn(courseCatalogModule, "findCourse").mockReturnValue(undefined);
    mountCourseView();
    expect(mockSetCourse).not.toHaveBeenCalled();
  });

  // Navigation is a link, not a click handler: it opens in a new tab, shows
  // its target on hover and survives a disabled script. The course is
  // already the selection by then (selected on mount, above).
  it("links the practice and mock CTAs to their pages", () => {
    const wrapper = mountCourseView();
    const ctas = wrapper.findAll(".course-cta-row a");
    expect(ctas.map((a) => a.attributes("href"))).toEqual(["/practice", "/mock"]);
    expect(ctas[0].text()).toMatch(/^Start practice/);
    expect(ctas[1].text()).toMatch(/^Timed mock run/);
    expect(wrapper.find(".course-cta-row button").exists()).toBe(false);
  });

  it("links each domain card to a filtered Practice", () => {
    const wrapper = mountCourseView();
    const domainLink = wrapper.find("a.domain-btn-link");
    expect(domainLink.attributes("aria-label")).toContain("Practice");
    expect(domainLink.attributes("href")).toMatch(/^\/practice\?domain=/);
  });

  it("injects Schema.org Course and Quiz structured data with free offers", () => {
    mountCourseView();
    const script = document.getElementById("schema-course-jsonld");
    expect(script).not.toBeNull();
    const data = JSON.parse(script?.textContent || "{}");
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@graph"]).toBeDefined();

    const courseObj = data["@graph"][0];
    expect(courseObj["@type"]).toBe("Course");
    expect(courseObj["name"]).toContain("Agentic AI Builder");
    expect(courseObj["offers"]).toEqual([
      {
        "@type": "Offer",
        category: "Free",
        price: "0",
        priceCurrency: "USD",
      },
    ]);
    expect(courseObj["courseWorkload"]).toBeUndefined();
    expect(courseObj["numberOfCredits"]).toBeUndefined();

    const quizObj = data["@graph"][1];
    expect(quizObj["@type"]).toBe("Quiz");
  });

  it("sets document title and restores original meta tags on unmount", () => {
    const wrapper = mountCourseView();
    expect(document.title).toContain("Agentic AI Builder — Practice Questions & Syllabus · mctl academy");
    const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content");
    expect(metaDesc).toContain("Agentic AI Builder");

    wrapper.unmount();
    // Router owns document.title on navigation away; CourseView restores meta and schema tags
    expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
      "Original Description",
    );
    expect(document.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(
      "Original OG Title",
    );
    expect(document.getElementById("schema-course-jsonld")).toBeNull();
  });

  it("renders all syllabus domains with weights and links", () => {
    const wrapper = mountCourseView();
    expect(wrapper.text()).toContain("Platform foundations and API access");
    expect(wrapper.text()).toContain("20% domain weight");
    expect(wrapper.text()).toContain("Practice this domain");
  });

  it("renders coming soon state when course is not yet available", () => {
    vi.spyOn(courseCatalogModule, "findCourse").mockReturnValueOnce({
      id: "upcoming-course",
      title: "Upcoming Track",
      publishedQuestionCount: 0,
      available: false,
      mock: { questionCount: 30, timeLimitMinutes: 60, discloseBankSize: true, domains: [] },
    });

    const wrapper = mountCourseView();
    expect(wrapper.find('[data-testid="course-coming-soon"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Upcoming Track");
    expect(wrapper.text()).toContain("Practice questions for this track are currently in preparation.");
    expect(wrapper.find('[data-testid="course-page"]').exists()).toBe(false);
  });

  it("renders 404 state when course does not exist", () => {
    vi.spyOn(courseCatalogModule, "findCourse").mockReturnValueOnce(undefined);

    const wrapper = mountCourseView();
    expect(wrapper.find('[data-testid="course-not-found"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Course not found");
    const actions = wrapper.findAll(".not-found-actions a");
    expect(actions.map((a) => [a.text(), a.attributes("href")])).toEqual([
      ["Go to home", "/"],
      ["Continue practice", "/practice"],
    ]);
  });
});
