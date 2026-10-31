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

function q(id: string, domain: string): Question {
  return {
    id,
    domain,
    objective: `${domain}/obj`,
    stem: `Stem ${id}`,
    options: [
      { id: "a", text: `Right ${id}`, correct: true, explanation: "r" },
      { id: "b", text: `Wrong ${id}`, correct: false, explanation: "w" },
      { id: "c", text: `Wrong2 ${id}`, correct: false, explanation: "w" },
      { id: "d", text: `Wrong3 ${id}`, correct: false, explanation: "w" },
    ],
  };
}

describe("MockResultsScreen summary and filters", () => {
  function session() {
    let s = startSession([q("q-1", "domain-1"), q("q-2", "domain-1"), q("q-3", "domain-2")], 60, Date.now());
    s = answerQuestion(s, "q-1", "a");
    s = answerQuestion(s, "q-2", "b");
    return submitSession(s, Date.now());
  }

  it("keeps unanswered separate from incorrect and the counts add up to the total", () => {
    const wrapper = mount(MockResultsScreen, { props: { session: session() } });
    expect(wrapper.find(".count-correct").text()).toBe("1 correct");
    expect(wrapper.find(".count-incorrect").text()).toBe("1 incorrect");
    expect(wrapper.find(".count-unanswered").text()).toBe("1 unanswered");
  });

  it("filters the question list by outcome", async () => {
    const wrapper = mount(MockResultsScreen, { props: { session: session() } });
    const show = (label: string) =>
      wrapper.findAll(".mock-results-filters button").find((b) => b.text() === label)!;
    expect(wrapper.findAll(".mock-results-question")).toHaveLength(3);
    await show("Incorrect").trigger("click");
    expect(wrapper.findAll(".mock-results-question").map((li) => li.text())).toEqual([
      expect.stringContaining("Stem q-2"),
    ]);
    await show("Unanswered").trigger("click");
    expect(wrapper.findAll(".mock-results-question").map((li) => li.text())).toEqual([
      expect.stringContaining("Stem q-3"),
    ]);
  });

  it("links the weakest domain to Practice and emits restart", async () => {
    const wrapper = mount(MockResultsScreen, { props: { session: session() } });
    const practice = wrapper.findAll(".mock-results-link").find((a) => a.text().startsWith("Practice"))!;
    expect(practice.attributes("href")).toBe("/practice?domain=domain-2");
    await wrapper.find(".mock-restart").trigger("click");
    expect(wrapper.emitted("restart")).toHaveLength(1);
  });
});
