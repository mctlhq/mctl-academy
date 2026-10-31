import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SkipLink from "../SkipLink.vue";

describe("SkipLink", () => {
  it("focuses the target without a fragment navigation", async () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.appendChild(main);
    const wrapper = mount(SkipLink, { props: { target: "main-content" }, attachTo: document.body });
    const before = window.location.href;

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.find("a").element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(main);
    expect(window.location.href).toBe(before);
    expect(wrapper.find("a").attributes("href")).toBe("#main-content");
    wrapper.unmount();
    main.remove();
  });
});
