import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
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
    const wrapper = mount(MockExamScreen, { props: { session }, attachTo: document.body });
    const submitButton = wrapper.findAll("button").find((b) => b.text() === "Submit exam")!;
    await submitButton.trigger("click");
    expect(document.body.querySelector('[data-testid="submit-confirm"]')).not.toBeNull();
    expect(document.body.textContent).toMatch(/0 of 1 answered/);
    expect(wrapper.emitted("submit")).toBeUndefined();
    document.body.querySelector<HTMLButtonElement>(".confirm-submit")!.click();
    await nextTick();
    expect(wrapper.emitted("submit")).toHaveLength(1);
    wrapper.unmount();
  });

  it("returns to the first unanswered question from the submit dialog", async () => {
    const base = makeSession();
    const second = { ...base.questions[0], id: "q-2", stem: "Second stem" };
    const session = { ...base, questions: [base.questions[0], second], answers: { "q-1": "a" } };
    const wrapper = mount(MockExamScreen, { props: { session }, attachTo: document.body });
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "Submit exam")!
      .trigger("click");
    document.body.querySelector<HTMLButtonElement>(".mock-exam-return")!.click();
    await nextTick();
    await nextTick();
    expect(wrapper.text()).toContain("Question 2 of 2");
    expect(wrapper.emitted("navigate")).toEqual([[1]]);
    expect(document.activeElement?.classList.contains("mock-exam-stem")).toBe(true);
    expect(wrapper.emitted("submit")).toBeUndefined();
    wrapper.unmount();
  });

  it("resumes on the saved question", () => {
    const base = makeSession();
    const session = { ...base, questions: [base.questions[0], { ...base.questions[0], id: "q-2" }] };
    const wrapper = mount(MockExamScreen, { props: { session, initialIndex: 1 } });
    expect(wrapper.text()).toContain("Question 2 of 2");
    wrapper.unmount();
  });

  it("does not make the ticking timer a live region; it announces milestones only", async () => {
    const base = makeSession();
    const now = Date.now();
    const session = { ...base, expiresAt: now + 5 * 60_000 + 400 };
    const wrapper = mount(MockExamScreen, { props: { session } });
    expect(wrapper.find('[data-testid="timer"]').attributes("aria-live")).toBeUndefined();
    const live = wrapper.find('[aria-live="polite"]');
    expect(live.text()).toBe("");
    await new Promise((r) => setTimeout(r, 900));
    expect(live.text()).toBe("5 minutes remaining");
    wrapper.unmount();
  });
});
