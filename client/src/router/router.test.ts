import { describe, expect, it } from "vitest";
import { pageTitle, router, scrollPosition, shouldFocusMain } from "./index";

describe("router", () => {
  it("names each page in the document title", () => {
    expect(pageTitle("Practice")).toBe("Practice · mctl academy");
    expect(pageTitle(undefined)).toBe("mctl academy");
  });

  it("sends an unknown URL to the not-found page instead of a blank screen", () => {
    expect(router.resolve("/no-such-page").name).toBe("not-found");
    expect(router.resolve("/practice?domain=domain-1").name).toBe("practice");
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
