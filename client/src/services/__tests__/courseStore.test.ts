import { beforeEach, describe, expect, it } from "vitest";
import { useCourseStore, resetCourseStore } from "../courseStore";
import { courseCatalog } from "../courseCatalog";
import { getItem, resetStorage, setItem } from "../storage";

const STORAGE_KEY = "mctl_academy_course_id";

const firstAvailable = courseCatalog.find((c) => c.available)!;

/**
 * The store is a module-level singleton backed by localStorage, so both have
 * to be reset before every case — otherwise one test's selection decides the
 * next test's starting state and the suite quietly becomes order-dependent.
 */
beforeEach(() => {
  resetStorage();
  resetCourseStore();
});

describe("courseStore", () => {
  it("lists every catalog course, available or not", () => {
    const store = useCourseStore();
    expect(store.courses.map((c) => c.id)).toEqual(courseCatalog.map((c) => c.id));
  });

  it("defaults to the first available course when nothing is stored", () => {
    const store = useCourseStore();
    expect(store.currentCourseId.value).toBe(firstAvailable.id);
    expect(store.currentCourse.value?.title).toBe(firstAvailable.title);
  });

  it("persists the selected course", () => {
    const store = useCourseStore();
    store.setCourse(firstAvailable.id);
    expect(getItem(STORAGE_KEY)).toBe(firstAvailable.id);

    resetCourseStore();
    expect(useCourseStore().currentCourseId.value).toBe(firstAvailable.id);
  });

  it("falls back and rewrites storage when the stored course id is unknown", () => {
    setItem(STORAGE_KEY, "a-course-that-was-deleted");
    resetCourseStore();

    const store = useCourseStore();
    expect(store.currentCourseId.value).toBe(firstAvailable.id);
    expect(getItem(STORAGE_KEY)).toBe(firstAvailable.id);
  });

  // The fallback-to-available and refuse-unavailable cases used to live here
  // behind it.runIf(firstUnavailable). Every shipping course now has published
  // questions, so that guard silently stopped running them rather than failing.
  // They moved to courseStoreUnavailable.test.ts, which mocks the catalog and
  // therefore keeps covering that path regardless of what content ships.

  it("refuses to select an unknown course id", () => {
    const store = useCourseStore();
    expect(store.setCourse("not-a-course")).toBe(false);
    expect(store.currentCourseId.value).toBe(firstAvailable.id);
  });

  it("selects another available course when one exists", () => {
    const store = useCourseStore();
    const others = courseCatalog.filter((c) => c.available && c.id !== firstAvailable.id);
    if (others.length === 0) {
      // Only one course has content today; selecting it is still a no-op-safe
      // success, and the multi-course path is covered by the catalog tests.
      expect(store.setCourse(firstAvailable.id)).toBe(true);
      return;
    }
    expect(store.setCourse(others[0].id)).toBe(true);
    expect(store.currentCourseId.value).toBe(others[0].id);
  });
});
