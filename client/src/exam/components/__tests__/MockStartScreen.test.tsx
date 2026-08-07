import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MockStartScreen } from "../MockStartScreen";
import type { ExamDataSource } from "../../dataSource";
import type { MockConfig, Question } from "../../types";

const baseConfig: MockConfig = {
  questionCount: 30,
  timeLimitMinutes: 60,
  discloseBankSize: true,
  domains: [
    { id: "domain-1", title: "D1", weight: 20, mockQuestions: 6 },
    { id: "domain-2", title: "D2", weight: 35, mockQuestions: 10 },
    { id: "domain-3", title: "D3", weight: 20, mockQuestions: 6 },
    { id: "domain-4", title: "D4", weight: 25, mockQuestions: 8 },
  ],
};

function makeDataSource(questions: Question[], bankSize: number): ExamDataSource {
  return {
    async getMockConfig() {
      return baseConfig;
    },
    async getQuestions() {
      return questions;
    },
    async getBankSize() {
      return bankSize;
    },
  };
}

describe("MockStartScreen", () => {
  it("T8: displays the live bank size and does not claim a repeat mock is guaranteed fresh", async () => {
    const dataSource = makeDataSource([], 20);
    render(<MockStartScreen dataSource={dataSource} onStart={() => {}} />);
    await waitFor(() => screen.getByTestId("bank-size"));
    expect(screen.getByTestId("bank-size")).toHaveTextContent("20 questions");
    expect(screen.getByText(/may include questions you have already seen/i)).toBeInTheDocument();
    expect(screen.getByText(/not guaranteed to be entirely fresh/i)).toBeInTheDocument();
  });

  it("renders a not-enough-content state when a domain cannot supply its quota", async () => {
    const dataSource = makeDataSource([], 0);
    render(<MockStartScreen dataSource={dataSource} onStart={() => {}} />);
    await waitFor(() => screen.getByTestId("not-enough-content"));
    expect(screen.queryByText("Start mock exam")).not.toBeInTheDocument();
  });
});
