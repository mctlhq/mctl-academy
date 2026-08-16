import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The unavailable-course path, exercised against a synthetic catalog.
 *
 * courseStore.test.ts covers the store against the catalog that actually
 * ships. Two of its cases used `it.runIf(firstUnavailable)`, which meant that
 * on the day every course had published questions they stopped running rather
 * than failing — the fallback and the refusal would have gone silently
 * uncovered exactly when the catalog stopped containing an example. That
 * happened when the CloudOps and Leader banks were published.
 *
 * Refusing to select an empty course is a property of the store, not of
 * whatever content is shipping this week, so it belongs in a file that owns
 * its own fixture. `vi.mock` is hoisted and file-scoped, which is why this
 * lives here instead of inside the other suite.
 */
vi.mock("../courseCatalog", async () => {
  const CATALOG = [
    { id: "available-course", title: "Available Course", publishedQuestionCount: 3, available: true },
    { id: "empty-course", title: "Empty Course", publishedQuestionCount: 0, available: false },
  ];
  return {
    courseCatalog: CATALOG,
    findCourse: (id?: string | null) => CATALOG.find((c) => c.id === id),
    isCourseAvailable: (id?: string | null) => CATALOG.some((c) => c.id === id && c.available),
    firstAvailableCourseId: () => CATALOG.find((c) => c.available)?.id ?? null,
    domainTitlesFor: () => ({}),
  };
});

const { useCourseStore, resetCourseStore } = await import("../courseStore");
const { getItem, resetStorage, setItem } = await import("../storage");

const STORAGE_KEY = "mctl_academy_course_id";

beforeEach(() => {
  resetStorage();
  resetCourseStore();
});

describe("courseStore with an unavailable course in the catalog", () => {
  it("lists the unavailable course, so it can be shown as coming soon", () => {
    const store = useCourseStore();
    expect(store.courses.map((c) => c.id)).toEqual(["available-course", "empty-course"]);
  });

  it("falls back and rewrites storage when the stored course has no published questions", () => {
    setItem(STORAGE_KEY, "empty-course");
    resetCourseStore();

    const store = useCourseStore();
    expect(store.currentCourseId.value).toBe("available-course");
    expect(getItem(STORAGE_KEY)).toBe("available-course");
  });

  it("refuses to select an unavailable course and keeps the current selection", () => {
    const store = useCourseStore();
    expect(store.canSelect("empty-course")).toBe(false);
    expect(store.setCourse("empty-course")).toBe(false);
    expect(store.currentCourseId.value).toBe("available-course");
  });
});
