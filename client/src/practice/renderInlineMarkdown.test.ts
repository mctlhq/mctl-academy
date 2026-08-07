import { describe, it, expect } from "vitest";
import { renderInlineMarkdown } from "./renderInlineMarkdown";

// Parity fixture with scripts/build-preview.mjs's esc()/md(): both must
// implement the same "escape everything, then backtick-only" contract since
// they render the same schema-validated stem/text fields (design.md risk:
// "Two Markdown renderers drifting apart").
const FIXTURES: Array<[input: string, expected: string]> = [
  ["plain text", "plain text"],
  ["<script>alert(1)</script>", "&lt;script&gt;alert(1)&lt;/script&gt;"],
  [`"quoted" & 'ticked'`, "&quot;quoted&quot; &amp; &#39;ticked&#39;"],
  ["Set `response_format` and <b>not this</b>", "Set <code>response_format</code> and &lt;b&gt;not this&lt;/b&gt;"],
  ["`a` and `b`", "<code>a</code> and <code>b</code>"],
];

// scripts/build-preview.mjs's esc()/md(), reproduced verbatim here as the
// parity reference (build-preview.mjs executes top-level side effects on
// import — reading content/ and writing dist/preview/ — so it cannot be
// imported directly from a unit test; the contract is paraphrased instead,
// per tasks.md task 5, and pinned by the assertions below).
function buildPreviewMd(s = ""): string {
  const esc = (s = "") =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
}

describe("renderInlineMarkdown", () => {
  for (const [input, expected] of FIXTURES) {
    it(`renders ${JSON.stringify(input)} as expected`, () => {
      expect(renderInlineMarkdown(input)).toBe(expected);
    });
  }

  it("matches build-preview.mjs's esc/md contract on every fixture", () => {
    for (const [input] of FIXTURES) {
      expect(renderInlineMarkdown(input)).toBe(buildPreviewMd(input));
    }
  });
});
