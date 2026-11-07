import { describe, expect, it } from "vitest";
import { pageTitle, router, scrollPosition, shouldFocusMain } from "./index";
import { resetCourseStore, useCourseStore } from "../services/courseStore";

describe("router", () => {
  it("names each page in the document title", () => {
    expect(pageTitle("Practice")).toBe("Practice · mctl academy");
    expect(pageTitle(undefined)).toBe("mctl academy");
  });

  it("sends an unknown URL to the not-found page instead of a blank screen", () => {
    expect(router.resolve("/no-such-page").name).toBe("not-found");
    expect(router.resolve("/practice?domain=domain-1").name).toBe("practice");
  });

  it("resolves course landing pages", () => {
    const courseRoute = router.resolve("/courses/agentic-ai-builder");
    expect(courseRoute.name).toBe("course");
    expect(courseRoute.params.courseId).toBe("agentic-ai-builder");

    // Certifications alias was removed to comply with LEGAL.md search positioning
    const certRoute = router.resolve("/certifications/ai-cloudops-engineer");
    expect(certRoute.name).toBe("not-found");
  });

  it("handles ?course= deep link parameter and strips it from query", async () => {
    resetCourseStore();
    const { currentCourseId, setCourse } = useCourseStore();

    await router.push("/practice?course=ai-leader&domain=domain-1");
    expect(currentCourseId.value).toBe("ai-leader");
    expect(router.currentRoute.value.path).toBe("/practice");
    expect(router.currentRoute.value.query).toEqual({ domain: "domain-1" });
    expect(router.currentRoute.value.query.course).toBeUndefined();

    // Course switcher works and is not reverted because ?course= is absent
    setCourse("agentic-ai-builder");
    expect(currentCourseId.value).toBe("agentic-ai-builder");
    expect(router.currentRoute.value.query.course).toBeUndefined();
  });

  it("strips unavailable ?course= query param without switching course", async () => {
    resetCourseStore();
    const { currentCourseId } = useCourseStore();
    const initialCourse = currentCourseId.value;

    await router.push("/practice?course=non-existent-track&domain=domain-2");
    expect(currentCourseId.value).toBe(initialCourse);
    expect(router.currentRoute.value.path).toBe("/practice");
    expect(router.currentRoute.value.query).toEqual({ domain: "domain-2" });
  });

  it("sets new page title when navigating away from course view", async () => {
    document.title = "";
    await router.push("/courses/agentic-ai-builder");
    expect(router.currentRoute.value.name).toBe("course");

    // Navigating away updates document.title via router.afterEach
    await router.push("/practice");
    expect(document.title).toBe("Practice · mctl academy");
  });

  it("scrolls a new page to the top but keeps position for query-only changes and back/forward", () => {
    expect(scrollPosition({ path: "/mock" }, { path: "/practice" }, null)).toEqual({ top: 0 });
    expect(scrollPosition({ path: "/practice" }, { path: "/practice" }, null)).toBe(false);
    expect(scrollPosition({ path: "/" }, { path: "/practice" }, { left: 0, top: 420 })).toEqual({
      left: 0,
      top: 420,
    });
  });

  it("moves focus to the main region only on an in-app page change", () => {
    const at = (path: string, loaded = true) => ({
      path,
      matched: loaded ? router.resolve(path).matched : [],
    });
    expect(shouldFocusMain(at("/mock"), at("/practice"))).toBe(true);
    expect(shouldFocusMain(at("/practice"), at("/practice"))).toBe(false);
    expect(shouldFocusMain(at("/practice"), at("/", false))).toBe(false);
  });
});
