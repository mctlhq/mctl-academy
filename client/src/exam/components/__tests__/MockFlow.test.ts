import { beforeEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import MockFlow from "../MockFlow.vue";
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
    const wrapper = mount(MockFlow, { props: { dataSource: makeDataSource() } });

    await flushPromises();
    expect(wrapper.find('[data-testid="mock-start"]').exists()).toBe(true);
    const startButton = wrapper.findAll("button").find((b) => b.text() === "Start mock exam")!;
    await startButton.trigger("click");

    expect(wrapper.find('[data-testid="mock-exam"]').exists()).toBe(true);
    // Options are shuffled per session, so select by the correct option's
    // known text rather than assuming a fixed radio index.
    const rightLabel = wrapper.findAll("label.mock-exam-option").find((l) => l.text().includes("Right one"))!;
    await rightLabel.find('input[type="radio"]').setValue();

    const submitButton = wrapper.findAll("button").find((b) => b.text() === "Submit exam")!;
    await submitButton.trigger("click");

    expect(wrapper.find('[data-testid="mock-results"]').exists()).toBe(true);

    const attempts = getStoredAttempts();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ questionId: "q-1", domain: "domain-1", correct: true });
  });
});
