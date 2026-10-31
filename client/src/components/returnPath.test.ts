import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./returnPath";

describe("safeReturnPath", () => {
  it("keeps a same-origin path with its query", () => {
    expect(safeReturnPath("/practice?domain=domain-2")).toBe("/practice?domain=domain-2");
    expect(safeReturnPath("/mock")).toBe("/mock");
  });

  it.each([
    ["//evil.example/x"],
    ["/\\evil.example"],
    ["https://evil.example/"],
    ["javascript:alert(1)"],
    ["/\t/evil.example"],
    [""],
    [undefined],
    [42],
  ])("falls back to / for %j", (candidate) => {
    expect(safeReturnPath(candidate)).toBe("/");
  });
});
