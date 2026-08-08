import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import MockExamScreen from "../MockExamScreen.vue";
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
    const wrapper = mount(MockExamScreen, { props: { session } });
    expect(wrapper.text()).toContain("Right one");
    expect(wrapper.text()).not.toContain("Why right");
    expect(wrapper.text()).not.toContain("Why wrong");
    expect(wrapper.text()).not.toContain("Why also wrong");
    expect(wrapper.text()).not.toContain("Why still wrong");
    wrapper.unmount();
  });

  it("emits answer with the question id and selected option id", async () => {
    const session = makeSession();
    const wrapper = mount(MockExamScreen, { props: { session } });
    const radios = wrapper.findAll('input[type="radio"]');
    await radios[0].setValue();
    expect(wrapper.emitted("answer")).toEqual([["q-1", session.questions[0].options[0].id]]);
    wrapper.unmount();
  });

  it("prompts for confirmation before submitting with unanswered questions", async () => {
    const session = makeSession();
    const wrapper = mount(MockExamScreen, { props: { session } });
    const submitButton = wrapper.findAll("button").find((b) => b.text() === "Submit exam")!;
    await submitButton.trigger("click");
    expect(wrapper.find('[data-testid="submit-confirm"]').exists()).toBe(true);
    expect(wrapper.emitted("submit")).toBeUndefined();
    const submitAnyway = wrapper.findAll("button").find((b) => b.text() === "Submit anyway")!;
    await submitAnyway.trigger("click");
    expect(wrapper.emitted("submit")).toHaveLength(1);
    wrapper.unmount();
  });
});
