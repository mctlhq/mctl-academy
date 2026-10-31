import { afterEach, describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import PracticeContent from "./PracticeContent.vue";
import { resetStorage } from "../services/storage";
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

  it("keeps the first answer as the score when other options are explored afterwards", async () => {
    const wrapper = mount(PracticeContent, { props: { bundle: [question("q-1")] } });
    await optionButton(wrapper, "Option A").trigger("click");
    await optionButton(wrapper, "Option B").trigger("click");
    await optionButton(wrapper, "Option C").trigger("click");

    const first = wrapper.find(".options li.first-answer");
    expect(first.text()).toContain("Option A");
    expect(first.text()).toContain("your first answer");
    expect(wrapper.findAll(".first-answer")).toHaveLength(1);

    await actionButton(wrapper, "Finish").trigger("click");
    expect(wrapper.text()).toMatch(/0 \/ 1 correct/i);
  });

  it("states the first-answer rule before the first answer and drops it after", async () => {
    const wrapper = mount(PracticeContent, { props: { bundle: [question("q-1"), question("q-2")] } });
    expect(wrapper.find(".first-answer-rule").exists()).toBe(true);
    await optionButton(wrapper, "Option B").trigger("click");
    expect(wrapper.find(".first-answer-rule").exists()).toBe(false);
  });

  it("does not repeat a verdict word the label already shows", async () => {
    const wrapper = mount(PracticeContent, {
      props: {
        bundle: [
          question("q-1", {
            options: [
              { id: "a", text: "Option A", correct: true, explanation: "Correct. Tokens expire hourly." },
              { id: "b", text: "Option B", correct: false, explanation: "Incorrect. Keys do not rotate." },
              { id: "c", text: "Option C", correct: false, explanation: "Plain" },
              { id: "d", text: "Option D", correct: false, explanation: "Last" },
            ],
          }),
        ],
      },
    });
    await optionButton(wrapper, "Option B").trigger("click");
    await optionButton(wrapper, "Option A").trigger("click");
    const explanations = wrapper.findAll(".explanation").map((e) => e.text());
    expect(explanations.sort()).toEqual(["Keys do not rotate.", "Tokens expire hourly."]);
  });

  it("links every source and quotes only excerpts the explanation does not already contain", async () => {
    const wrapper = mount(PracticeContent, {
      props: {
        bundle: [
          question("q-1", {
            sources: [
              { title: "Guide", url: "https://example.test/guide", excerpt: "B is right, in detail" },
              { title: "Reference", url: "https://example.test/ref", excerpt: "A separate quoted line." },
            ],
          } as Partial<BundleQuestion>),
        ],
      },
    });
    await optionButton(wrapper, "Option B").trigger("click");
    expect(wrapper.findAll(".answer-sources .source-link a").map((a) => a.text())).toEqual([
      "Guide",
      "Reference",
    ]);
    const quotes = wrapper.findAll(".source-quotes blockquote").map((q) => q.text());
    expect(quotes).toEqual(["A separate quoted line."]);
  });

  it("shows the domain filter with a way to clear it", () => {
    const wrapper = mount(PracticeContent, {
      props: { bundle: [question("q-1")], domainLabel: "Agent architecture" },
    });
    expect(wrapper.find('[data-testid="practice-context"]').text()).toContain("Agent architecture");
    expect(wrapper.find("a.clear-filter").attributes("href")).toBe("/practice");
  });

  it("keeps the repeat-all mode when clearing a domain filter", () => {
    const wrapper = mount(PracticeContent, {
      props: { bundle: [question("q-1")], domainLabel: "Agent architecture", mode: "all" },
    });
    expect(wrapper.find("a.clear-filter").attributes("href")).toBe("/practice?mode=all");
  });

  it("does not show the Practice queue note in an empty Review mistakes view", () => {
    const wrapper = mount(PracticeContent, {
      props: { bundle: [question("q-1")], mode: "mistakes", emptyMessage: "No mistakes yet." },
    });
    expect(wrapper.text()).toContain("No mistakes yet.");
    expect(wrapper.find(".queue-note").exists()).toBe(false);
  });

  describe("keyboard shortcuts", () => {
    afterEach(() => resetStorage());
    const press = (key: string, init: KeyboardEventInit = {}) =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));

    it("answers with 1-4, skips with S and advances with N", async () => {
      const wrapper = mount(PracticeContent, {
        props: { bundle: [question("q-1"), question("q-2"), question("q-3")] },
        attachTo: document.body,
      });
      press("s");
      await nextTick();
      expect(wrapper.find(".progress").text()).toContain("Question 2");
      press("2");
      await nextTick();
      expect(wrapper.find(".feedback").exists()).toBe(true);
      // Answering with the mouse leaves focus on the option button; N must
      // still advance from there.
      const option = wrapper.find(".options button").element as HTMLButtonElement;
      option.focus();
      option.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
      await nextTick();
      expect(wrapper.find(".progress").text()).toContain("Question 3");
      wrapper.unmount();
    });

    it("ignores keys typed into a text-entry control", async () => {
      const wrapper = mount(PracticeContent, {
        props: { bundle: [question("q-1"), question("q-2")] },
        attachTo: document.body,
      });
      for (const tag of ["input", "textarea", "select"]) {
        const field = document.createElement(tag);
        document.body.appendChild(field);
        for (const key of ["1", "s"])
          field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        field.remove();
      }
      const editable = document.createElement("div");
      editable.setAttribute("contenteditable", "true");
      document.body.appendChild(editable);
      editable.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
      editable.remove();
      await nextTick();
      expect(wrapper.find(".feedback").exists()).toBe(false);
      expect(wrapper.find(".progress").text()).toContain("Question 1");
      wrapper.unmount();
    });

    it("ignores keys while a dialog is open, with modifiers, or when turned off", async () => {
      const wrapper = mount(PracticeContent, {
        props: { bundle: [question("q-1"), question("q-2")] },
        attachTo: document.body,
      });
      const dialog = document.createElement("div");
      dialog.setAttribute("aria-modal", "true");
      document.body.appendChild(dialog);
      press("1");
      await nextTick();
      expect(wrapper.find(".feedback").exists()).toBe(false);
      dialog.remove();

      press("1", { ctrlKey: true });
      press("1", { isComposing: true });
      await nextTick();
      expect(wrapper.find(".feedback").exists()).toBe(false);

      if (!wrapper.find(".shortcut-toggle input").exists())
        await wrapper.find(".context-toggle").trigger("click");
      await wrapper.find(".shortcut-toggle input").trigger("change");
      press("1");
      await nextTick();
      expect(wrapper.find(".feedback").exists()).toBe(false);
      wrapper.unmount();
    });
  });
});
