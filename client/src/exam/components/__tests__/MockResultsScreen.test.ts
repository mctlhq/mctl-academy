import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import MockResultsScreen from "../MockResultsScreen.vue";
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
    const wrapper = mount(MockResultsScreen, { props: { session: makeSubmittedSession() } });
    expect(wrapper.find('[data-testid="score"]').text()).toContain("0 / 1 correct");
    expect(wrapper.text()).toContain("Why right");
    expect(wrapper.text()).toContain("Why wrong");
    expect(wrapper.text()).toContain("Why also wrong");
    expect(wrapper.text()).toContain("Why still wrong");
  });
});
