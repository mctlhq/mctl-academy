import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PracticeScreen } from "./PracticeScreen";
import type { BundleQuestion } from "./usePracticeSession";

function question(id: string, overrides: Partial<BundleQuestion> = {}): BundleQuestion {
  return {
    id,
    domain: "domain-1",
    objective: "domain-1/api-authentication",
    stem: `Stem for ${id}`,
    options: [
      { id: "a", text: "Option A", correct: false, explanation: "Why A is wrong, in detail." },
      { id: "b", text: "Option B", correct: true, explanation: "Why B is right, in detail." },
      { id: "c", text: "Option C", correct: false, explanation: "Why C is wrong, in detail." },
      { id: "d", text: "Option D", correct: false, explanation: "Why D is wrong, in detail." },
    ],
    ...overrides,
  };
}

describe("PracticeScreen", () => {
  it("reveals an incorrect option's explanation without revealing other options, then reveals the correct one independently", async () => {
    const user = userEvent.setup();
    render(<PracticeScreen bundle={[question("q-1")]} />);

    await user.click(screen.getByRole("button", { name: /option a/i }));

    expect(screen.getByText(/why a is wrong, in detail/i)).toBeInTheDocument();
    expect(screen.getByText(/^incorrect$/i)).toBeInTheDocument();
    // The correct option's own feedback must not appear yet.
    expect(screen.queryByText(/why b is right, in detail/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /option b/i }));

    expect(screen.getByText(/why b is right, in detail/i)).toBeInTheDocument();
    expect(screen.getByText(/^correct$/i)).toBeInTheDocument();
    // Both selections stay visible — exploring one does not hide the other.
    expect(screen.getByText(/why a is wrong, in detail/i)).toBeInTheDocument();
  });

  it("does not reveal anything before any option is selected", () => {
    render(<PracticeScreen bundle={[question("q-1")]} />);
    expect(screen.queryByText(/why a is wrong, in detail/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^correct$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^incorrect$/i)).not.toBeInTheDocument();
  });

  it("shows a summary with the score after the last question, counting first selections only", async () => {
    const user = userEvent.setup();
    const bundle = [question("q-1"), question("q-2")];
    render(<PracticeScreen bundle={bundle} />);

    // Question 1: first click correct (id "b" is correct for both fixtures).
    await user.click(screen.getByRole("button", { name: /option b/i }));
    await user.click(screen.getByRole("button", { name: /next question/i }));

    // Question 2: first click wrong.
    await user.click(screen.getByRole("button", { name: /option a/i }));
    await user.click(screen.getByRole("button", { name: /finish/i }));

    expect(screen.getByRole("heading", { name: /session complete/i })).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 2 correct/i)).toBeInTheDocument();
  });

  it("renders an empty state instead of crashing when the bundle has zero published questions", () => {
    render(<PracticeScreen bundle={[]} />);
    expect(screen.getByRole("heading", { name: /practice/i })).toBeInTheDocument();
    expect(screen.getByText(/no published questions yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
