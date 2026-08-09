import rawCatalog from "../course-catalog.json";

/**
 * The client's view of the course catalog, generated from
 * content/courses/*.yaml by scripts/build-content-bundle.mjs.
 *
 * There is no second catalog in TypeScript. Adding a course, renaming one, or
 * publishing its first questions is a content change; nothing here needs to be
 * edited for a new course to appear and become selectable.
 *
 * Only vendor-neutral fields cross this boundary. `prepares_for`, the course
 * description and the disclaimer name a certification vendor and stay in
 * content/ — LEGAL.md forbids them in nav labels, URLs, page titles and images.
 */
export interface CourseDomainConfig {
  id: string;
  title: string;
  weight: number;
  mockQuestions: number;
}

export interface CourseMockConfig {
  questionCount: number;
  timeLimitMinutes: number;
  discloseBankSize: boolean;
  domains: CourseDomainConfig[];
}

export interface CourseInfo {
  id: string;
  title: string;
  /** Questions that actually reached the published bundle for this course. */
  publishedQuestionCount: number;
  /** False when the course has no published questions yet ("Coming soon"). */
  available: boolean;
  mock: CourseMockConfig;
}

export const courseCatalog = rawCatalog as unknown as readonly CourseInfo[];

export function findCourse(courseId: string | null | undefined): CourseInfo | undefined {
  if (!courseId) return undefined;
  return courseCatalog.find((c) => c.id === courseId);
}

export function isCourseAvailable(courseId: string | null | undefined): boolean {
  return findCourse(courseId)?.available ?? false;
}

/**
 * Domain id -> human title for one course, for progress readouts. Titles are
 * per-course canonical metadata: two courses both have a "domain-1", and they
 * are not the same domain.
 */
export function domainTitlesFor(courseId: string | null | undefined): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const d of findCourse(courseId)?.mock.domains ?? []) {
    titles[d.id] = d.title;
  }
  return titles;
}

/** The course a learner lands on when nothing valid is remembered. */
export function firstAvailableCourseId(): string | null {
  return courseCatalog.find((c) => c.available)?.id ?? null;
}
