import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import UserNav from "./UserNav.vue";
import type { UserProfile } from "../types/user";

const user: UserProfile = {
  id: "user-1",
  name: "Dmitrii Mashkov",
  email: "dmitrii@example.com",
  image: null,
  githubLogin: "mashkovd",
};

describe("UserNav", () => {
  it("offers a login action to guests", () => {
    const wrapper = mount(UserNav, { props: { user: null, loading: false } });
    expect(wrapper.get("button").text()).toContain("Log in");
  });

  it("shows account identity, logout, and deletion controls for a signed-in learner", () => {
    const wrapper = mount(UserNav, { props: { user, loading: false } });

    expect(wrapper.get("summary").attributes("aria-label")).toContain("mashkovd");
    expect(wrapper.text()).toContain("Log out");
    expect(wrapper.text()).toContain("Delete account");
  });
});
