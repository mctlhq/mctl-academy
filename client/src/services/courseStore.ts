import { computed, ref } from "vue";
import { getItem, removeItem, setItem } from "./storage";
import {
  courseCatalog,
  findCourse,
  firstAvailableCourseId,
  isCourseAvailable,
  type CourseInfo,
} from "./courseCatalog";

/**
 * Which course the learner is currently studying.
 *
 * Backed entirely by the generated catalog: a course id is selectable only if
 * the build emitted published questions for it. A course defined in
 * content/courses/ with no published questions stays visible in the switcher
 * as "Coming soon" but cannot be selected, so the learner can never end up
 * looking at one course's questions under another course's name.
 *
 * The selection is persisted, and a persisted value that no longer names an
 * available course (renamed, retired, or content pulled) falls back to the
 * first available course and rewrites storage — a stale id must not strand
 * the app on an empty screen.
 */
const STORAGE_KEY = "mctl_academy_course_id";

function readStored(): string | null {
  return getItem(STORAGE_KEY);
}

function writeStored(courseId: string | null): void {
  // Storage may be unavailable (private browsing, quota); ./storage degrades to
  // an in-memory fallback so selection still works for this session.
  if (courseId === null) removeItem(STORAGE_KEY);
  else setItem(STORAGE_KEY, courseId);
}

function resolveInitialCourseId(): string | null {
  const stored = readStored();
  if (stored && isCourseAvailable(stored)) return stored;

  const fallback = firstAvailableCourseId();
  if (stored !== fallback) writeStored(fallback);
  return fallback;
}

const currentCourseId = ref<string | null>(resolveInitialCourseId());

/**
 * Re-reads storage and rebuilds module state. Tests own this: the store is a
 * module-level singleton, so without an explicit reset one test's selection
 * would leak into the next and make the suite order-dependent.
 */
export function resetCourseStore(): void {
  currentCourseId.value = resolveInitialCourseId();
}

export function useCourseStore() {
  const currentCourse = computed<CourseInfo | undefined>(() => findCourse(currentCourseId.value));

  /** True when the id names a course the learner is allowed to switch to. */
  function canSelect(courseId: string): boolean {
    return isCourseAvailable(courseId);
  }

  function setCourse(courseId: string): boolean {
    if (!canSelect(courseId)) return false;
    if (currentCourseId.value !== courseId) {
      currentCourseId.value = courseId;
    }
    writeStored(courseId);
    return true;
  }

  return {
    /** Every defined course, available or not — unavailable ones render disabled. */
    courses: courseCatalog,
    currentCourseId,
    currentCourse,
    canSelect,
    setCourse,
  };
}
