// Types for courseMeta.mjs. The implementation stays plain JavaScript because
// server/spa.mjs imports it directly at runtime, with no build step.

export interface CourseMetaInput {
  id: string;
  title: string;
  publishedQuestionCount: number;
  available: boolean;
  mock: { domains: readonly unknown[] };
}

export interface CourseHeadMeta {
  title: string;
  description: string | null;
  canonicalUrl: string | null;
  jsonLd: Record<string, unknown> | null;
}

export interface CourseHeadTagSpec {
  tag: "meta" | "link";
  match: readonly [string, string];
  attr: "content" | "href";
  field: "title" | "description" | "canonicalUrl";
}

export const SITE_ORIGIN: string;
export const SITE_NAME: string;
export const COURSE_NOT_FOUND_TITLE: string;
export const PAGE_NOT_FOUND_TITLE: string;
export const COURSE_JSONLD_ID: string;
export const COURSE_HEAD_TAGS: readonly CourseHeadTagSpec[];
export function pageTitle(title: unknown): string;
export function headTagSelector(spec: CourseHeadTagSpec): string;
export function courseCanonicalUrl(courseId: string): string;
export function courseHeadMeta(course: CourseMetaInput): CourseHeadMeta;
