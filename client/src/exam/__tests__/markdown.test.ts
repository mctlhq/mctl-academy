import { describe, expect, it } from "vitest";
import { parseRestrictedMarkdown } from "../markdown";

describe("parseRestrictedMarkdown", () => {
  it("T9: leaves raw HTML as literal text and only expands backtick code spans", () => {
    const segments = parseRestrictedMarkdown("before `code` <script>alert(1)</script> after");
    expect(segments).toEqual([
      { type: "text", value: "before " },
      { type: "code", value: "code" },
      { type: "text", value: " <script>alert(1)</script> after" },
    ]);
  });

  it("returns a single text segment when there are no code spans", () => {
    expect(parseRestrictedMarkdown("plain text")).toEqual([{ type: "text", value: "plain text" }]);
  });
});
