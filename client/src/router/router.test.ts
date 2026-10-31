import { describe, expect, it } from "vitest";
import { pageTitle, router } from "./index";

describe("router", () => {
  it("names each page in the document title", () => {
    expect(pageTitle("Practice")).toBe("Practice · mctl academy");
    expect(pageTitle(undefined)).toBe("mctl academy");
  });

  it("sends an unknown URL to the not-found page instead of a blank screen", () => {
    expect(router.resolve("/no-such-page").name).toBe("not-found");
    expect(router.resolve("/practice?domain=domain-1").name).toBe("practice");
  });
});
