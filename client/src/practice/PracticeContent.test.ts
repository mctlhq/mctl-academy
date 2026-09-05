import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import PracticeContent from "./PracticeContent.vue";
import type { BundleQuestion } from "../services/contentBundle";

function question(id: string, overrides: Partial<BundleQuestion> = {}): BundleQuestion {
  return {
    id,
    course_id: "agentic-ai-builder",
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

describe("PracticeContent", () => {
  it("reveals an incorrect option's explanation without revealing other options, then reveals the correct one independently", async () => {
    const wrapper = mount(PracticeContent, { props: { bundle: [question("q-1")] } });

    await optionButton(wrapper, "Option A").trigger("click");

    expect(wrapper.text()).toContain("Why A is wrong, in detail.");
    expect(wrapper.text()).toContain("Incorrect");
    expect(wrapper.text()).not.toContain("Why B is right, in detail.");

    await optionButton(wrapper, "Option B").trigger("click");

    expect(wrapper.text()).toContain("Why B is right, in detail.");
    expect(wrapper.text()).toContain("Correct");
    expect(wrapper.text()).toContain("Why A is wrong, in detail.");
  });

  it("does not reveal anything before any option is selected", () => {
    const wrapper = mount(PracticeContent, { props: { bundle: [question("q-1")] } });
    expect(wrapper.text()).not.toContain("Why A is wrong, in detail.");
    expect(wrapper.text()).not.toContain("Correct");
    expect(wrapper.text()).not.toContain("Incorrect");
  });

  it("shows a summary with the score after the last question, counting first selections only", async () => {
    const bundle = [question("q-1"), question("q-2")];
    const wrapper = mount(PracticeContent, { props: { bundle } });

    await optionButton(wrapper, "Option B").trigger("click");
    await actionButton(wrapper, "Next question").trigger("click");

    await optionButton(wrapper, "Option A").trigger("click");
    await actionButton(wrapper, "Finish").trigger("click");

    expect(wrapper.find("h1").text()).toMatch(/session complete/i);
    expect(wrapper.text()).toMatch(/1 \/ 2 correct/i);
  });

  it("recreates the options list when advancing so its scroll position resets", async () => {
    const wrapper = mount(PracticeContent, { props: { bundle: [question("q-1"), question("q-2")] } });
    const firstOptionsList = wrapper.find(".options").element;

    await actionButton(wrapper, "Skip").trigger("click");

    expect(wrapper.find(".options").element).not.toBe(firstOptionsList);
  });

  it("renders an empty state instead of crashing when the bundle has zero published questions", () => {
    const wrapper = mount(PracticeContent, { props: { bundle: [] } });
    expect(wrapper.find("h1").text()).toMatch(/practice/i);
    expect(wrapper.text()).toMatch(/no published questions in this selection yet/i);
    expect(wrapper.find("button").exists()).toBe(false);
  });

  it("renders HTML/script payloads as inert text, never as markup", () => {
    const wrapper = mount(PracticeContent, {
      props: {
        bundle: [
          question("q-1", {
            stem: "What is `<script>alert(1)</script>`?",
            options: [
              {
                id: "a",
                text: "<b>bold</b> claim",
                correct: true,
                explanation: "<img src=x onerror=alert(1)> in explain",
              },
              { id: "b", text: "Plain", correct: false, explanation: "Plain too" },
              { id: "c", text: "Also plain", correct: false, explanation: "Also plain" },
              { id: "d", text: "Last", correct: false, explanation: "Last" },
            ],
          }),
        ],
      },
    });
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find(".stem b").exists()).toBe(false);
    expect(wrapper.text()).toContain("<script>alert(1)</script>");
    expect(wrapper.text()).toContain("<b>bold</b>");
  });

  it("renders backtick code spans as <code> elements in stem, option and explanation", async () => {
    const wrapper = mount(PracticeContent, {
      props: {
        bundle: [
          question("q-1", {
            stem: "Set `response_format` correctly",
            options: [
              { id: "a", text: "Use `json_object`", correct: true, explanation: "Call `api.create()` first" },
              { id: "b", text: "No code here", correct: false, explanation: "No code" },
              { id: "c", text: "Plain", correct: false, explanation: "Plain" },
              { id: "d", text: "Last", correct: false, explanation: "Last" },
            ],
          }),
        ],
      },
    });
    const stemCode = wrapper.find(".stem code");
    expect(stemCode.exists()).toBe(true);
    expect(stemCode.text()).toBe("response_format");
    const optionCode = wrapper.find(".option-text code");
    expect(optionCode.exists()).toBe(true);
    expect(optionCode.text()).toBe("json_object");
    await optionButton(wrapper, "json_object").trigger("click");
    const explainCode = wrapper.find(".explanation code");
    expect(explainCode.exists()).toBe(true);
    expect(explainCode.text()).toBe("api.create()");
  });

  it("announces the verdict via a single aria-live region, then clears when advancing", async () => {
    const wrapper = mount(PracticeContent, { props: { bundle: [question("q-1"), question("q-2")] } });
    const liveRegion = wrapper.find('[aria-live="polite"]');
    expect(liveRegion.exists()).toBe(true);
    expect(liveRegion.text()).toBe("");

    await optionButton(wrapper, "Option A").trigger("click");
    expect(liveRegion.text()).toBe("Incorrect");

    await optionButton(wrapper, "Option B").trigger("click");
    expect(liveRegion.text()).toBe("Correct");

    await actionButton(wrapper, "Next question").trigger("click");
    await nextTick();
    expect(liveRegion.text()).toBe("");
  });
});
