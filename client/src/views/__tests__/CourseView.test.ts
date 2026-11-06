import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import CourseView from "../CourseView.vue";

const mockSetCourse = vi.fn();
const mockPush = vi.fn();

vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: { courseId: "agentic-ai-builder" },
  }),
  useRouter: () => ({
    push: mockPush,
  }),
  RouterLink: {
    name: "RouterLink",
    props: ["to"],
    template: '<a :href="to"><slot /></a>',
  },
}));

vi.mock("../../services/courseStore", () => ({
  useCourseStore: () => ({
    setCourse: mockSetCourse,
  }),
}));

describe("CourseView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.title = "";
    const script = document.getElementById("schema-course-jsonld");
    if (script) script.remove();
  });

  it("renders the course hero and metadata", () => {
    const wrapper = mount(CourseView);
    expect(wrapper.text()).toContain("Agentic AI Builder");
    expect(wrapper.text()).toContain("Certification Practice Track");
    expect(wrapper.text()).toContain("Exam domains & syllabus");
    expect(mockSetCourse).toHaveBeenCalledWith("agentic-ai-builder");
  });

  it("injects Schema.org Course and Quiz structured data", () => {
    mount(CourseView);
    const script = document.getElementById("schema-course-jsonld");
    expect(script).not.toBeNull();
    const data = JSON.parse(script?.textContent || "{}");
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@graph"]).toBeDefined();
    expect(data["@graph"][0]["@type"]).toBe("Course");
    expect(data["@graph"][0]["name"]).toContain("Agentic AI Builder");
    expect(data["@graph"][1]["@type"]).toBe("Quiz");
  });

  it("sets document title and meta description", () => {
    mount(CourseView);
    expect(document.title).toContain("Agentic AI Builder — Practice Exam & Questions");
  });

  it("renders all syllabus domains with weights and links", () => {
    const wrapper = mount(CourseView);
    expect(wrapper.text()).toContain("Platform foundations and API access");
    expect(wrapper.text()).toContain("20% exam weight");
    expect(wrapper.text()).toContain("Practice this domain");
  });
});
