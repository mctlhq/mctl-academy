import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MockResultsScreen } from "../MockResultsScreen";
import { answerQuestion, startSession, submitSession } from "../../session";
import type { Question } from "../../types";

function makeSubmittedSession() {
  const questions: Question[] = [
    {
      id: "q-1",
      domain: "domain-1",
      objective: "domain-1/obj",
      stem: "Stem",
      options: [
        { id: "a", text: "Right one", correct: true, explanation: "Why right" },
        { id: "b", text: "Wrong one", correct: false, explanation: "Why wrong" },
        { id: "c", text: "Also wrong", correct: false, explanation: "Why also wrong" },
        { id: "d", text: "Still wrong", correct: false, explanation: "Why still wrong" },
      ],
    },
  ];
  const started = startSession(questions, 60, Date.now());
  const answered = answerQuestion(started, "q-1", "b");
  return submitSession(answered, Date.now());
}

describe("MockResultsScreen", () => {
  it("T7: renders the overall score, the correct option, and every option's explanation", () => {
    render(<MockResultsScreen session={makeSubmittedSession()} />);
    expect(screen.getByTestId("score")).toHaveTextContent("0 / 1 correct");
    expect(screen.getByText("Why right")).toBeInTheDocument();
    expect(screen.getByText("Why wrong")).toBeInTheDocument();
    expect(screen.getByText("Why also wrong")).toBeInTheDocument();
    expect(screen.getByText("Why still wrong")).toBeInTheDocument();
  });
});
