import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import RestrictedMarkdown from "../RestrictedMarkdown.vue";

describe("RestrictedMarkdown component", () => {
  it("T9: renders a potential HTML injection as inert text, never as markup", () => {
    const wrapper = mount(RestrictedMarkdown, {
      props: { text: "<img src=x onerror=alert(1)> then `safe`" },
    });
    expect(wrapper.text()).toContain("<img src=x onerror=alert(1)>");
    expect(wrapper.find("img").exists()).toBe(false);
    const code = wrapper.find("code");
    expect(code.exists()).toBe(true);
    expect(code.text()).toBe("safe");
  });
});
