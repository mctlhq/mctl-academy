import { describe, expect, it } from "vitest";
import { allQuestions, questionIdsForCourse, questionsForCourse } from "../contentBundle";
import { courseCatalog } from "../courseCatalog";

describe("contentBundle", () => {
  it("every bundled question names a course from the catalog", () => {
    const known = new Set(courseCatalog.map((c) => c.id));
    for (const q of allQuestions) {
      expect(known.has(q.course_id)).toBe(true);
    }
  });

  it("scopes the bank to one course and never leaks another course's questions", () => {
    for (const course of courseCatalog) {
      const scoped = questionsForCourse(course.id);
      expect(scoped.every((q) => q.course_id === course.id)).toBe(true);
      expect(scoped).toHaveLength(course.publishedQuestionCount);
    }
  });

  it("the catalog's publishedQuestionCount matches the shipped bundle", () => {
    const counted = new Map<string, number>();
    for (const q of allQuestions) counted.set(q.course_id, (counted.get(q.course_id) ?? 0) + 1);

    for (const course of courseCatalog) {
      expect(course.publishedQuestionCount).toBe(counted.get(course.id) ?? 0);
      expect(course.available).toBe(course.publishedQuestionCount > 0);
    }
  });

  it("returns nothing for an unknown or absent course rather than falling back to another", () => {
    expect(questionsForCourse("not-a-course")).toEqual([]);
    expect(questionsForCourse(null)).toEqual([]);
    expect(questionIdsForCourse(null).size).toBe(0);
  });

  it("no vendor certification naming reaches the client catalog", () => {
    const serialized = JSON.stringify(courseCatalog);
    expect(serialized).not.toContain("prepares_for");
    expect(serialized).not.toContain("Nebius");
  });
});
