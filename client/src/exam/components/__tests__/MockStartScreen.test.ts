import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import MockStartScreen from "../MockStartScreen.vue";
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
    const wrapper = mount(MockStartScreen, { props: { dataSource } });
    await flushPromises();
    expect(wrapper.find('[data-testid="bank-size"]').text()).toContain("20 questions");
    expect(wrapper.text()).toMatch(/may include questions you have already seen/i);
    expect(wrapper.text()).toMatch(/not guaranteed to be entirely fresh/i);
  });

  it("renders a not-enough-content state when a domain cannot supply its quota", async () => {
    const dataSource = makeDataSource([], 0);
    const wrapper = mount(MockStartScreen, { props: { dataSource } });
    await flushPromises();
    expect(wrapper.find('[data-testid="not-enough-content"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Start mock exam");
  });
});
