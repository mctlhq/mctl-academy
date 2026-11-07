import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import CourseView from "../CourseView.vue";
import * as courseCatalogModule from "../../services/courseCatalog";

const mockSetCourse = vi.fn().mockReturnValue(true);
const mockPush = vi.fn();
let currentRouteParams = { courseId: "agentic-ai-builder" };

vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: currentRouteParams,
  }),
  useRouter: () => ({
    push: mockPush,
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
    currentRouteParams = { courseId: "agentic-ai-builder" };
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

  it("renders the course hero and metadata without hijacking currentCourseId on mount", () => {
    const wrapper = mountCourseView();
    expect(wrapper.text()).toContain("Agentic AI Builder");
    expect(wrapper.text()).toContain("Practice track");
    expect(wrapper.text()).toContain("Practice domains & syllabus");
    expect(mockSetCourse).not.toHaveBeenCalled();
  });

  it("calls setCourse and navigates only when learner triggers practice action", async () => {
    const wrapper = mountCourseView();
    const startBtn = wrapper.find(".course-cta-row button");
    await startBtn.trigger("click");
    expect(mockSetCourse).toHaveBeenCalledWith("agentic-ai-builder");
    expect(mockPush).toHaveBeenCalledWith("/practice");
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
    expect(document.title).toBe("Original Title");
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
  });
});
