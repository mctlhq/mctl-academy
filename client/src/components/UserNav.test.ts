import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import UserNav from "./UserNav.vue";
import type { UserProfile } from "../types/user";

const user: UserProfile = {
  id: "user-1",
  name: "Dmitrii Mashkov",
  email: "dmitrii@example.com",
  image: null,
  githubLogin: "mashkovd",
};

function stubSignInOptions(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body })),
  );
}

describe("UserNav", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers a login action to guests", () => {
    const wrapper = mount(UserNav, { props: { user: null, loading: false } });
    expect(wrapper.get("button").text()).toContain("Log in");
  });

  it("shows only the GitHub login when the server has no ZITADEL sign-in", async () => {
    stubSignInOptions({ zitadel: null });
    const wrapper = mount(UserNav, { props: { user: null, loading: false } });
    await flushPromises();
    expect(wrapper.findAll("button")).toHaveLength(1);
    expect(wrapper.find(".signin-zitadel").exists()).toBe(false);
    expect(wrapper.get(".signin-github").attributes("aria-label")).toBe("Log in");
  });

  it("adds the ZITADEL login, with the server's label, when the server offers it", async () => {
    stubSignInOptions({ zitadel: { providerId: "zitadel", label: "MCTL account" } });
    const wrapper = mount(UserNav, { props: { user: null, loading: false } });
    await flushPromises();
    expect(wrapper.get(".signin-zitadel").text()).toContain("Log in with MCTL account");
    // Two buttons side by side: the GitHub one names its provider too.
    expect(wrapper.get(".signin-github").text()).toBe("Log in with GitHub");
    expect(wrapper.get(".signin-github").attributes("aria-label")).toBe("Log in with GitHub");
  });

  it("gives the iconless ZITADEL button a short label for narrow screens", async () => {
    stubSignInOptions({ zitadel: { providerId: "zitadel", label: "MCTL account" } });
    const wrapper = mount(UserNav, { props: { user: null, loading: false } });
    await flushPromises();
    // AppNav.vue hides .signin-label below 560px and shows this one instead;
    // without it the button would be empty on a phone.
    const short = wrapper.get(".signin-zitadel .signin-label-short");
    expect(short.text()).toBe("MCTL account");
    expect(short.attributes("aria-hidden")).toBe("true");
    expect(wrapper.get(".signin-zitadel").attributes("aria-label")).toBe("Log in with MCTL account");
  });

  it("keeps the GitHub login alone when the options cannot be read", async () => {
    stubSignInOptions({}, false);
    const wrapper = mount(UserNav, { props: { user: null, loading: false } });
    await flushPromises();
    expect(wrapper.find(".signin-zitadel").exists()).toBe(false);
  });

  it("shows account identity, logout, and deletion controls for a signed-in learner", () => {
    const wrapper = mount(UserNav, { props: { user, loading: false } });

    expect(wrapper.get("summary").attributes("aria-label")).toContain("mashkovd");
    expect(wrapper.text()).toContain("Log out");
    expect(wrapper.text()).toContain("Delete account");
  });
});
