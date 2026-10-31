import { describe, expect, it } from "vitest";
import { explanationBody, isExcerptInExplanation } from "./answerText";

describe("explanationBody", () => {
  it("drops only a leading verdict word that the label already shows", () => {
    expect(explanationBody("Correct. The guide states `advanced` searches more broadly.")).toBe(
      "The guide states `advanced` searches more broadly.",
    );
    expect(explanationBody("Incorrect. Nucleus sampling is unaffected.")).toBe(
      "Nucleus sampling is unaffected.",
    );
  });

  it("leaves everything else untouched", () => {
    for (const text of [
      "Correct answers require a token.",
      "Correctly configured clients retry.",
      "The output is not Correct. at all",
      "Correct.",
      "Why B is right, in detail.",
    ]) {
      expect(explanationBody(text)).toBe(text);
    }
  });
});

describe("isExcerptInExplanation", () => {
  it("matches a quoted excerpt regardless of case and punctuation", () => {
    expect(
      isExcerptInExplanation(
        "Advanced search depth searches more broadly.",
        'Correct. The guide states "advanced search depth searches more broadly".',
      ),
    ).toBe(true);
  });

  it("does not match a different sentence or an empty excerpt", () => {
    expect(isExcerptInExplanation("Basic is faster.", "Advanced searches more broadly.")).toBe(false);
    expect(isExcerptInExplanation("", "Anything")).toBe(false);
  });

  it("matches whole words only", () => {
    expect(isExcerptInExplanation("port", "Use the export command.")).toBe(false);
    expect(isExcerptInExplanation("rate limit", "An accurate limit applies.")).toBe(false);
    expect(isExcerptInExplanation("port", "Set the port first.")).toBe(true);
  });
});
