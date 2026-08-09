import { describe, it, expect } from "vitest";
import { useCourseStore, COURSES } from "../courseStore";

describe("useCourseStore", () => {
  it("provides available courses list", () => {
    const store = useCourseStore();
    expect(store.courses).toEqual(COURSES);
    expect(store.currentCourseId.value).toBe("agentic-ai-builder");
  });

  it("updates course selection and persists", () => {
    const store = useCourseStore();
    store.setCourse("ai-leader");

    expect(store.currentCourseId.value).toBe("ai-leader");
    expect(store.currentCourse.value.shortName).toBe("AI Leader");
  });

  it("ignores invalid course ids", () => {
    const store = useCourseStore();
    store.setCourse("invalid-course-id");
    expect(store.currentCourseId.value).toBe("ai-leader"); // unchanged
  });
});
