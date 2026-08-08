import { describe, expect, it } from "vitest";
import { buildQuestionIssueUrl, QUESTION_ISSUES_URL } from "./questionIssue";

describe("buildQuestionIssueUrl", () => {
  it("opens a pre-filled issue in the Academy repository", () => {
    const url = new URL(buildQuestionIssueUrl("q-123", "factual_error", "The cited behavior changed."));

    expect(`${url.origin}${url.pathname}`).toBe(QUESTION_ISSUES_URL);
    expect(url.searchParams.get("title")).toBe("[Question q-123] Factual or technical inaccuracy");
    expect(url.searchParams.get("body")).toContain("**Question ID:** `q-123`");
    expect(url.searchParams.get("body")).toContain("The cited behavior changed.");
  });

  it("uses an explicit placeholder when no details are supplied", () => {
    const url = new URL(buildQuestionIssueUrl("q-456", "typo", "   "));
    expect(url.searchParams.get("body")).toContain("_No additional details provided._");
  });
});
