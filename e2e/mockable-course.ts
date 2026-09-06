import { readFileSync } from "node:fs";

type CatalogCourse = {
  id: string;
  available: boolean;
  mock: { questionCount: number; domains: { id: string; mockQuestions: number }[] };
};
type BundleQuestion = { course_id: string; domain: string };

const bundle: BundleQuestion[] = JSON.parse(
  readFileSync(new URL("../client/src/content-bundle.json", import.meta.url), "utf8"),
);
const catalog: CatalogCourse[] = JSON.parse(
  readFileSync(new URL("../client/src/course-catalog.json", import.meta.url), "utf8"),
);

/**
 * The first course whose shipped bank can fill its own Mock. Read from the
 * generated artefacts rather than hard-coded: a fail-closed quarantine can
 * take any course below its Mock quota, and these specs test the exam UI,
 * not the state of the bank.
 */
export function mockableCourse(): string {
  const course = catalog.find(
    (c) =>
      c.available &&
      c.mock.domains.every(
        (d) => bundle.filter((q) => q.course_id === c.id && q.domain === d.id).length >= d.mockQuestions,
      ),
  );
  if (!course)
    throw new Error("no course in the shipped bundle can fill its Mock; nothing to test the exam UI against");
  return course.id;
}
