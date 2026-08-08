import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PracticeScreen from "./PracticeScreen.vue";
import type { BundleQuestion } from "./usePracticeSession";

function question(id: string, overrides: Partial<BundleQuestion> = {}): BundleQuestion {
  return {
    id,
    domain: "domain-1",
    objective: "domain-1/api-authentication",
    stem: `Stem for ${id}`,
    options: [
      { id: "a", text: "Option A", correct: false, explanation: "Why A is wrong, in detail." },
      { id: "b", text: "Option B", correct: true, explanation: "Why B is right, in detail." },
      { id: "c", text: "Option C", correct: false, explanation: "Why C is wrong, in detail." },
      { id: "d", text: "Option D", correct: false, explanation: "Why D is wrong, in detail." },
    ],
    ...overrides,
  };
}

function optionButton(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper.findAll(".options button").find((b) => b.text().includes(label));
  if (!button) throw new Error(`No option button found for "${label}"`);
  return button;
}

function actionButton(wrapper: ReturnType<typeof mount>, label: string) {
  const button = wrapper.findAll("button").find((b) => b.text().trim().toLowerCase() === label.toLowerCase());
  if (!button) throw new Error(`No button found for "${label}"`);
  return button;
}

describe("PracticeScreen", () => {
  it("reveals an incorrect option's explanation without revealing other options, then reveals the correct one independently", async () => {
    const wrapper = mount(PracticeScreen, { props: { bundle: [question("q-1")] } });

    await optionButton(wrapper, "Option A").trigger("click");

    expect(wrapper.text()).toContain("Why A is wrong, in detail.");
    expect(wrapper.text()).toContain("Incorrect");
    // The correct option's own feedback must not appear yet.
    expect(wrapper.text()).not.toContain("Why B is right, in detail.");

    await optionButton(wrapper, "Option B").trigger("click");

    expect(wrapper.text()).toContain("Why B is right, in detail.");
    expect(wrapper.text()).toContain("Correct");
    // Both selections stay visible — exploring one does not hide the other.
    expect(wrapper.text()).toContain("Why A is wrong, in detail.");
  });

  it("does not reveal anything before any option is selected", () => {
    const wrapper = mount(PracticeScreen, { props: { bundle: [question("q-1")] } });
    expect(wrapper.text()).not.toContain("Why A is wrong, in detail.");
    expect(wrapper.text()).not.toContain("Correct");
    expect(wrapper.text()).not.toContain("Incorrect");
  });

  it("shows a summary with the score after the last question, counting first selections only", async () => {
    const bundle = [question("q-1"), question("q-2")];
    const wrapper = mount(PracticeScreen, { props: { bundle } });

    // Question 1: first click correct (id "b" is correct for both fixtures).
    await optionButton(wrapper, "Option B").trigger("click");
    await actionButton(wrapper, "Next question").trigger("click");

    // Question 2: first click wrong.
    await optionButton(wrapper, "Option A").trigger("click");
    await actionButton(wrapper, "Finish").trigger("click");

    expect(wrapper.find("h1").text()).toMatch(/session complete/i);
    expect(wrapper.text()).toMatch(/1 \/ 2 correct/i);
  });

  it("recreates the options list when advancing so its scroll position resets", async () => {
    const wrapper = mount(PracticeScreen, { props: { bundle: [question("q-1"), question("q-2")] } });
    const firstOptionsList = wrapper.find(".options").element;

    await actionButton(wrapper, "Next question").trigger("click");

    expect(wrapper.find(".options").element).not.toBe(firstOptionsList);
  });

  it("renders an empty state instead of crashing when the bundle has zero published questions", () => {
    const wrapper = mount(PracticeScreen, { props: { bundle: [] } });
    expect(wrapper.find("h1").text()).toMatch(/practice/i);
    expect(wrapper.text()).toMatch(/no published questions yet/i);
    expect(wrapper.find("button").exists()).toBe(false);
  });
});
