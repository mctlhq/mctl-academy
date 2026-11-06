import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AppFooter from "../AppFooter.vue";

describe("AppFooter", () => {
  // LEGAL.md states that the independence disclaimer appears in the footer.
  it("shows the independence disclaimer", () => {
    const text = mount(AppFooter).get('[data-testid="independence-disclaimer"]').text();
    expect(text).toContain("not affiliated with, endorsed by, or sponsored by Nebius");
    expect(text).toContain("any other certification vendor");
  });
});
