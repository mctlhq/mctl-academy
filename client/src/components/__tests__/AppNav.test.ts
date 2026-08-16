import { describe, test, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import AppNav from "../AppNav.vue";
import { courseCatalog } from "../../services/courseCatalog";

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

  test("renders one option per catalog course, labelling unavailable ones", async () => {
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

    // Derived from the catalog rather than hard-coded: the labels depend on
    // which courses have published questions, which changes whenever content
    // ships. Asserting literals here meant the test failed the moment the
    // CloudOps and Leader banks were published — a content change breaking a
    // component test that was still describing the component correctly.
    const optionTexts = options.map((opt) => opt.text().trim());
    const expected = courseCatalog.map((c) => (c.available ? c.title : `${c.title} — Coming soon`));
    expect(optionTexts).toEqual(expected);
  });
});
