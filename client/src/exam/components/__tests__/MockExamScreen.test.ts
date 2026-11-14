import { afterEach, describe, expect, it, vi } from "vitest";
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

  function twoQuestionSession() {
    const base = makeSession();
    return { ...base, questions: [base.questions[0], { ...base.questions[0], id: "q-2" }] };
  }

  it("names the screen and position in a visually hidden heading", () => {
    const wrapper = mount(MockExamScreen, { props: { session: twoQuestionSession(), initialIndex: 1 } });
    const h1 = wrapper.get("h1");
    expect(h1.classes()).toContain("sr-only");
    expect(h1.text()).toBe("Mock exam – question 2 of 2");
    wrapper.unmount();
  });

  it("marks answered navigator items neutrally, with a check, never as correct", () => {
    const base = twoQuestionSession();
    const session = { ...base, answers: { "q-1": "b" } };
    const wrapper = mount(MockExamScreen, { props: { session } });
    const [first, second] = wrapper.findAll(".mock-exam-nav-item");
    expect(first.classes()).toEqual(expect.arrayContaining(["answered", "current"]));
    expect(first.find(".mock-exam-nav-check").text()).toBe("✓");
    expect(first.attributes("aria-label")).toBe("Question 1, answered");
    expect(second.find(".mock-exam-nav-check").exists()).toBe(false);
    expect(wrapper.html()).not.toMatch(/status-ok|correct/);
    wrapper.unmount();
  });

  describe("on a phone (<=620px)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stubNarrow(matches: boolean) {
      vi.stubGlobal(
        "matchMedia",
        vi.fn().mockImplementation((query: string) => ({
          matches,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        })),
      );
    }

    it("collapses the navigator behind a 'Question N of M' summary and closes it after a pick", async () => {
      stubNarrow(true);
      const wrapper = mount(MockExamScreen, { props: { session: twoQuestionSession() } });
      const details = wrapper.get<HTMLDetailsElement>(".mock-exam-nav-panel");
      expect(details.element.open).toBe(false);
      expect(wrapper.get('[data-testid="mock-nav-summary"]').text()).toBe("Question 1 of 2");

      details.element.open = true;
      await details.trigger("toggle");
      expect(details.element.open).toBe(true);

      await wrapper.findAll(".mock-exam-nav-item")[1].trigger("click");
      expect(details.element.open).toBe(false);
      expect(wrapper.get('[data-testid="mock-nav-summary"]').text()).toBe("Question 2 of 2");
      wrapper.unmount();
    });

    it("keeps the navigator open on wider screens", () => {
      stubNarrow(false);
      const wrapper = mount(MockExamScreen, { props: { session: twoQuestionSession() } });
      expect(wrapper.get<HTMLDetailsElement>(".mock-exam-nav-panel").element.open).toBe(true);
      wrapper.unmount();
    });
  });
});
