import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MockFlow } from "../MockFlow";
import type { ExamDataSource } from "../../dataSource";
import type { MockConfig, Question } from "../../types";
import { clearProgress, getStoredAttempts } from "../../../services/progressStore";

const config: MockConfig = {
  questionCount: 1,
  timeLimitMinutes: 60,
  discloseBankSize: false,
  domains: [{ id: "domain-1", title: "D1", weight: 100, mockQuestions: 1 }],
};

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

function makeDataSource(): ExamDataSource {
  return {
    async getMockConfig() {
      return config;
    },
    async getQuestions() {
      return questions;
    },
    async getBankSize() {
      return questions.length;
    },
  };
}

describe("MockFlow", () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearProgress();
  });

  it("records a progress attempt for every question on submit", async () => {
    render(<MockFlow dataSource={makeDataSource()} />);

    await waitFor(() => screen.getByTestId("mock-start"));
    fireEvent.click(screen.getByText("Start mock exam"));

    await waitFor(() => screen.getByTestId("mock-exam"));
    // Options are shuffled per session, so select by the correct option's
    // known text rather than assuming a fixed radio index.
    fireEvent.click(screen.getByRole("radio", { name: "Right one" }));

    fireEvent.click(screen.getByText("Submit exam"));

    await waitFor(() => screen.getByTestId("mock-results"));

    const attempts = getStoredAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ questionId: "q-1", domain: "domain-1", correct: true });
  });
});
