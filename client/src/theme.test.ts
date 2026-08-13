import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyTheme } from "./theme";

describe("applyTheme", () => {
  beforeEach(() => {
    document.head.innerHTML = `
      <meta name="theme-color" content="#0a0b0d" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    `;
  });

  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("uses dark browser chrome for the dark theme", () => {
    applyTheme("dark");

    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#0a0b0d");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')?.content,
    ).toBe("black-translucent");
  });

  it("uses contrasting browser chrome for the light theme", () => {
    applyTheme("light");

    expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#f5f2ea");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')?.content,
    ).toBe("default");
  });
});
