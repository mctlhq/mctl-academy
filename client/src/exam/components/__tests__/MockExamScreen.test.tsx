import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MockExamScreen } from "../MockExamScreen";
import { startSession } from "../../session";
import type { Question } from "../../types";

function makeSession() {
  const questions: Question[] = [
    {
      id: "q-1",
      domain: "domain-1",
      objective: "domain-1/obj",
      stem: "Stem with a secret answer",
      options: [
        { id: "a", text: "Right one", correct: true, explanation: "Why right" },
        { id: "b", text: "Wrong one", correct: false, explanation: "Why wrong" },
        { id: "c", text: "Also wrong", correct: false, explanation: "Why also wrong" },
        { id: "d", text: "Still wrong", correct: false, explanation: "Why still wrong" },
      ],
    },
  ];
  return startSession(questions, 60, Date.now());
}

describe("MockExamScreen", () => {
  it("T6: never renders any option's explanation, nor a correct/incorrect marker, while in_progress", () => {
    const session = makeSession();
    const { unmount } = render(
      <MockExamScreen session={session} onAnswer={() => {}} onSubmit={() => {}} onTimeExpired={() => {}} />,
    );
    expect(screen.getByText("Right one")).toBeInTheDocument();
    expect(screen.queryByText("Why right")).not.toBeInTheDocument();
    expect(screen.queryByText("Why wrong")).not.toBeInTheDocument();
    expect(screen.queryByText("Why also wrong")).not.toBeInTheDocument();
    expect(screen.queryByText("Why still wrong")).not.toBeInTheDocument();
    unmount();
  });

  it("calls onAnswer with the question id and selected option id", () => {
    const session = makeSession();
    const onAnswer = vi.fn();
    const { unmount } = render(
      <MockExamScreen session={session} onAnswer={onAnswer} onSubmit={() => {}} onTimeExpired={() => {}} />,
    );
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[0]);
    expect(onAnswer).toHaveBeenCalledWith("q-1", session.questions[0].options[0].id);
    unmount();
  });

  it("prompts for confirmation before submitting with unanswered questions", () => {
    const session = makeSession();
    const onSubmit = vi.fn();
    const { unmount } = render(
      <MockExamScreen session={session} onAnswer={() => {}} onSubmit={onSubmit} onTimeExpired={() => {}} />,
    );
    fireEvent.click(screen.getByText("Submit exam"));
    expect(screen.getByTestId("submit-confirm")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Submit anyway"));
    expect(onSubmit).toHaveBeenCalled();
    unmount();
  });
});
