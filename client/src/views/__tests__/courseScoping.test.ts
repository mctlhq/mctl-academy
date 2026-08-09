import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import type { BundleQuestion } from "../../services/contentBundle";

/**
 * The course-scoping contract for the learning surfaces.
 *
 * Two synthetic courses stand in for the real catalog, because the shipped
 * content only has published questions for one course today — and "questions
 * never cross courses" is exactly the property that cannot be demonstrated
 * with a single course.
 *
 * Fixtures live inside vi.hoisted so the vi.mock factories (hoisted above
 * every import) can close over them.
 */
const fixtures = vi.hoisted(() => {
  const question = (id: string, courseId: string) => ({
    id,
    course_id: courseId,
    domain: "domain-1",
    objective: "domain-1/alpha",
    stem: `Stem ${id}`,
    options: [
      { id: "a", text: `A ${id}`, correct: false, explanation: "Explanation A, long enough." },
      { id: "b", text: `B ${id}`, correct: true, explanation: "Explanation B, long enough." },
      { id: "c", text: `C ${id}`, correct: false, explanation: "Explanation C, long enough." },
      { id: "d", text: `D ${id}`, correct: false, explanation: "Explanation D, long enough." },
    ],
  });

  const alpha = ["a-1", "a-2", "a-3"].map((id) => question(id, "course-alpha"));
  const beta = ["b-1", "b-2"].map((id) => question(id, "course-beta"));

  return {
    alpha,
    beta,
    all: [...alpha, ...beta],
    // Populated with a real Vue ref below; the mock reads it lazily.
    courseRef: { value: "course-alpha" as string | null },
    mistakeIds: [] as string[],
  };
});

vi.mock("../../services/courseStore", () => ({
  useCourseStore: () => ({ currentCourseId: fixtures.courseRef }),
  resetCourseStore: () => {},
}));

vi.mock("../../services/contentBundle", () => ({
  allQuestions: fixtures.all,
  questionsForCourse: (courseId: string | null) =>
    courseId ? fixtures.all.filter((q) => q.course_id === courseId) : [],
  questionIdsForCourse: (courseId: string | null) =>
    new Set(
      (courseId ? fixtures.all.filter((q) => q.course_id === courseId) : []).map((q) => q.id),
    ),
}));

vi.mock("../../services/progressStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/progressStore")>();
  return { ...actual, getMistakeQuestionIds: () => fixtures.mistakeIds };
});

import { ref } from "vue";
import PracticeView from "../PracticeView.vue";
import MistakesView from "../MistakesView.vue";

// A real ref, so the views react to a course change exactly as they do in the app.
const currentCourseId = ref<string | null>("course-alpha");
fixtures.courseRef = currentCourseId as unknown as { value: string | null };

const renderedIds = (text: string, pool: Array<{ id: string }>) =>
  pool.filter((q) => text.includes(`Stem ${q.id}`)).map((q) => q.id);

const ALPHA = fixtures.alpha as unknown as BundleQuestion[];
const BETA = fixtures.beta as unknown as BundleQuestion[];

describe("course scoping", () => {
  beforeEach(() => {
    currentCourseId.value = "course-alpha";
    fixtures.mistakeIds = [];
  });

  it("Practice only ever shows the active course's questions", () => {
    const wrapper = mount(PracticeView);
    const text = wrapper.text();

    expect(text).toMatch(/Question 1 of 3/);
    expect(renderedIds(text, BETA)).toEqual([]);
  });

  it("switching course discards the running session and builds a fresh scoped one", async () => {
    const wrapper = mount(PracticeView);
    await wrapper.findAll(".options button")[0].trigger("click");
    expect(wrapper.text()).toMatch(/Correct|Incorrect/);

    currentCourseId.value = "course-beta";
    await nextTick();

    const text = wrapper.text();
    // A brand new session: beta's two questions, back at question 1, with no
    // revealed feedback carried over from the discarded alpha session.
    expect(text).toMatch(/Question 1 of 2/);
    expect(renderedIds(text, ALPHA)).toEqual([]);
    expect(text).not.toMatch(/Explanation [ABCD], long enough\./);
  });

  it("Review Mistakes intersects mistakes with the active course's question ids", async () => {
    fixtures.mistakeIds = ["a-1", "b-1", "b-2"];

    const wrapper = mount(MistakesView);
    expect(wrapper.text()).toMatch(/Question 1 of 1/);
    expect(renderedIds(wrapper.text(), BETA)).toEqual([]);

    currentCourseId.value = "course-beta";
    await nextTick();

    expect(wrapper.text()).toMatch(/Question 1 of 2/);
    expect(renderedIds(wrapper.text(), ALPHA)).toEqual([]);
  });

  it("Review Mistakes shows its empty state when the mistakes belong to another course", () => {
    fixtures.mistakeIds = ["b-1"];
    const wrapper = mount(MistakesView);
    expect(wrapper.text()).toMatch(/no recorded mistakes in this course/i);
  });
});
