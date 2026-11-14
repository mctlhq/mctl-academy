import type { CourseInfo } from "./courseCatalog";

/**
 * A course whose published bank cannot yet fill one full mock exam is still
 * growing ("Early access"). Derived from the catalog, so the label disappears
 * on its own once the bank is big enough. The course card and the course page
 * share this one threshold so they can never disagree.
 */
export function isEarlyAccess(course: CourseInfo): boolean {
  return course.available && course.publishedQuestionCount < course.mock.questionCount;
}
