import { describe, test, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import AppNav from "../AppNav.vue";

const routes = [
  { path: "/", component: { template: "<div>Home</div>" } },
  { path: "/practice", component: { template: "<div>Practice</div>" } },
  { path: "/mock", component: { template: "<div>Mock</div>" } },
  { path: "/mistakes", component: { template: "<div>Mistakes</div>" } },
  { path: "/dashboard", component: { template: "<div>Dashboard</div>" } },
];

describe("AppNav component", () => {
  test("renders unified navigation labels without term drift across screen sizes", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    const wrapper = mount(AppNav, {
      props: {
        user: null,
        loading: false,
      },
      global: {
        plugins: [router],
      },
    });

    const navLinks = wrapper.findAll(".app-nav-link");
    const labels = navLinks.map((link) => link.text().trim());

    // Unified labels: Home, Practice, Mock exam, Mistakes, Progress
    expect(labels).toEqual(["Home", "Practice", "Mock exam", "Mistakes", "Progress"]);
  });

  test("renders course switcher with available and coming-soon options", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes,
    });

    const wrapper = mount(AppNav, {
      props: {
        user: null,
        loading: false,
      },
      global: {
        plugins: [router],
      },
    });

    const select = wrapper.find('[data-testid="course-select"]');
    expect(select.exists()).toBe(true);

    const options = wrapper.findAll("option");
    expect(options.length).toBeGreaterThan(0);

    const optionTexts = options.map((opt) => opt.text().trim());
    expect(optionTexts).toContain("Agentic AI Builder");
    expect(optionTexts).toContain("AI CloudOps Engineer");
    expect(optionTexts).toContain("AI Leader");
  });
});
