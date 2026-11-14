import { describe, test, expect, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, watch } from "vue";
import { RouterView } from "vue-router";
import CourseView from "../../views/CourseView.vue";
import { createRouter, createMemoryHistory } from "vue-router";
import AppNav from "../AppNav.vue";
import { courseCatalog } from "../../services/courseCatalog";
import { useCourseStore } from "../../services/courseStore";

const routes = [
  { path: "/", component: { template: "<div>Home</div>" } },
  { path: "/practice", component: { template: "<div>Practice</div>" } },
  { path: "/mock", component: { template: "<div>Mock</div>" } },
  { path: "/mistakes", component: { template: "<div>Mistakes</div>" } },
  { path: "/dashboard", component: { template: "<div>Dashboard</div>" } },
  { path: "/courses/:courseId", name: "course", component: { template: "<div>Course</div>" } },
];

const [firstCourse, secondCourse] = courseCatalog.filter((c) => c.available);

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

    const navLinks = wrapper.findAll(".mctl-site-nav a");
    const labels = navLinks.map((link) => link.find("span").text().trim());

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

  test("always shows the mistakes count, muted when there is nothing to review", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    const wrapper = mount(AppNav, { props: { user: null, loading: false }, global: { plugins: [router] } });

    const badge = wrapper.get('[data-testid="mistake-badge"]');
    expect(badge.text()).toBe("0");
    expect(badge.classes()).toContain("mistake-badge-empty");
    expect(wrapper.get('a[href="/mistakes"]').attributes("aria-label")).toBe("Mistakes, 0 to review");
  });

  test("keeps the course next to the brand, with the full title available", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    const wrapper = mount(AppNav, { props: { user: null, loading: false }, global: { plugins: [router] } });

    const brand = wrapper.get(".mctl-site-brand");
    const context = wrapper.get(".mctl-site-header__context");
    expect(brand.element.nextElementSibling).toBe(context.element);
    const select = context.get('[data-testid="course-select"]');
    const selected = courseCatalog.find((c) => c.id === (select.element as HTMLSelectElement).value);
    expect(select.attributes("title")).toBe(selected?.title);
    expect(wrapper.get('label[for="course-select"]').text()).toBe("Course");
  });

  test("uses the shared shell: app variant, burger wired to the nav", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    const wrapper = mount(AppNav, { props: { user: null, loading: false }, global: { plugins: [router] } });

    expect(wrapper.get("header").classes()).toEqual(
      expect.arrayContaining(["mctl-site-header", "mctl-site-header--app", "mctl-site-header--drawer-wide"]),
    );
    const burger = wrapper.get(".mctl-site-burger");
    expect(burger.attributes("aria-controls")).toBe(wrapper.get(".mctl-site-nav").attributes("id"));
    expect(burger.attributes("aria-expanded")).toBe("false");
  });

  test("burger toggles data-nav-open; Escape closes it and returns focus", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    const wrapper = mount(AppNav, {
      props: { user: null, loading: false },
      global: { plugins: [router] },
      attachTo: document.body,
    });
    const header = wrapper.get("header");
    const burger = wrapper.get(".mctl-site-burger");

    await burger.trigger("click");
    expect(header.attributes("data-nav-open")).toBeDefined();
    expect(burger.attributes("aria-expanded")).toBe("true");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(header.attributes("data-nav-open")).toBeUndefined();
    expect(burger.attributes("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(burger.element);

    await burger.trigger("click");
    await router.push("/practice");
    await wrapper.vm.$nextTick();
    expect(header.attributes("data-nav-open")).toBeUndefined();
    wrapper.unmount();
  });

  test("closes the drawer when the viewport grows past the drawer range (981px)", async () => {
    let listener: ((e: MediaQueryListEvent) => void) | undefined;
    const queries: string[] = [];
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => {
      queries.push(q);
      return {
        matches: false,
        media: q,
        addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => (listener = l),
        removeEventListener: () => {},
      } as unknown as MediaQueryList;
    }) as typeof window.matchMedia;
    try {
      const router = createRouter({ history: createMemoryHistory(), routes });
      const wrapper = mount(AppNav, { props: { user: null, loading: false }, global: { plugins: [router] } });
      expect(queries).toContain("(min-width: 981px)");
      await wrapper.get(".mctl-site-burger").trigger("click");
      expect(wrapper.get("header").attributes("data-nav-open")).toBeDefined();
      listener?.({ matches: true } as MediaQueryListEvent);
      await wrapper.vm.$nextTick();
      expect(wrapper.get("header").attributes("data-nav-open")).toBeUndefined();
      wrapper.unmount();
    } finally {
      window.matchMedia = original;
    }
  });

  describe("course switcher", () => {
    beforeEach(() => {
      // The store is a module singleton: start every case from a known course.
      useCourseStore().setCourse(firstCourse.id);
    });

    async function mountAt(path: string) {
      const router = createRouter({ history: createMemoryHistory(), routes });
      await router.push(path);
      const wrapper = mount(AppNav, { props: { user: null, loading: false }, global: { plugins: [router] } });
      return { router, wrapper };
    }

    test("on a course page, picking another course opens that course's page", async () => {
      const { router, wrapper } = await mountAt(`/courses/${firstCourse.id}`);
      await wrapper.get('[data-testid="course-select"]').setValue(secondCourse.id);
      await flushPromises();
      expect(router.currentRoute.value.path).toBe(`/courses/${secondCourse.id}`);
      expect(useCourseStore().currentCourseId.value).toBe(secondCourse.id);
    });

    test("elsewhere, picking a course changes the selection and stays on the page", async () => {
      const { router, wrapper } = await mountAt("/practice");
      await wrapper.get('[data-testid="course-select"]').setValue(secondCourse.id);
      await flushPromises();
      expect(router.currentRoute.value.path).toBe("/practice");
      expect(useCourseStore().currentCourseId.value).toBe(secondCourse.id);
    });

    test("with the app's keyed view, the switch never flips back to the old course", async () => {
      // App.vue keys the routed view on fullPath + selected course. Selecting
      // before navigating remounts the still-current /courses/X page, which
      // selects X again: the switcher visibly bounces (or, without the
      // navigation, the switch is lost altogether).
      const { currentCourseId } = useCourseStore();
      const Harness = defineComponent({
        setup() {
          return () => [
            h(AppNav, { user: null, loading: false }),
            h(RouterView, null, {
              default: ({ Component, route }: { Component: unknown; route: { fullPath: string } }) =>
                Component
                  ? h(Component as never, { key: `${route.fullPath}-${currentCourseId.value}` })
                  : null,
            }),
          ];
        },
      });
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          ...routes.filter((r) => r.name !== "course"),
          { path: "/courses/:courseId", name: "course", component: CourseView },
        ],
      });
      await router.push(`/courses/${firstCourse.id}`);
      const wrapper = mount(Harness, { global: { plugins: [router] } });
      await flushPromises();

      const seen: (string | null)[] = [];
      const stop = watch(currentCourseId, (id) => seen.push(id), { flush: "sync" });
      await wrapper.get('[data-testid="course-select"]').setValue(secondCourse.id);
      await flushPromises();
      stop();

      expect(router.currentRoute.value.path).toBe(`/courses/${secondCourse.id}`);
      expect(seen).toEqual([secondCourse.id]);
      wrapper.unmount();
    });
  });
});
