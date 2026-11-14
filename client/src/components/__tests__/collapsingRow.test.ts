import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { nextCollapseState, useCollapsingRow, type CollapseInput } from "../collapsingRow";

const base: CollapseInput = {
  y: 400,
  anchorY: 400,
  collapsed: false,
  blocked: false,
  topZone: 100,
  threshold: 8,
};

describe("nextCollapseState", () => {
  test("collapses on a scroll down past the threshold and re-anchors", () => {
    expect(nextCollapseState({ ...base, y: 408 })).toEqual({ collapsed: true, anchorY: 408 });
  });

  test("shows again on a scroll up past the threshold", () => {
    expect(nextCollapseState({ ...base, collapsed: true, y: 392 })).toEqual({
      collapsed: false,
      anchorY: 392,
    });
  });

  test("ignores movement smaller than the threshold and keeps the anchor", () => {
    expect(nextCollapseState({ ...base, collapsed: true, y: 395 })).toEqual({
      collapsed: true,
      anchorY: 400,
    });
    expect(nextCollapseState({ ...base, y: 405 })).toEqual({ collapsed: false, anchorY: 400 });
  });

  test("always shows the row near the top of the page", () => {
    expect(nextCollapseState({ ...base, anchorY: 0, y: 100 }).collapsed).toBe(false);
    // Overscroll on iOS reports negative positions.
    expect(nextCollapseState({ ...base, collapsed: true, y: -20 }).collapsed).toBe(false);
  });

  test("never collapses while blocked (focus inside, open menu, wide viewport)", () => {
    expect(nextCollapseState({ ...base, blocked: true, y: 900 })).toEqual({
      collapsed: false,
      anchorY: 900,
    });
  });
});

describe("useCollapsingRow", () => {
  let phone = true;
  let frames: FrameRequestCallback[] = [];
  const mqListeners = new Set<() => void>();
  // Unmounted after each test even when an assertion fails first, so a
  // failing test cannot leave scroll listeners behind for the next one.
  const live: Array<{ unmount: () => void }> = [];

  beforeEach(() => {
    phone = true;
    frames = [];
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return query === "(max-width: 480px)" && phone;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => mqListeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => mqListeners.delete(fn),
    }));
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => frames.push(fn));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    window.scrollY = 0;
  });

  afterEach(() => {
    live.splice(0).forEach((w) => w.unmount());
    vi.unstubAllGlobals();
    mqListeners.clear();
    window.scrollY = 0;
  });

  function scrollTo(y: number) {
    window.scrollY = y;
    window.dispatchEvent(new Event("scroll"));
  }
  function flushFrames() {
    const pending = frames;
    frames = [];
    pending.forEach((fn) => fn(0));
  }

  function mountHost(blocked = () => false) {
    let collapsed!: ReturnType<typeof useCollapsingRow>;
    const Host = defineComponent({
      setup() {
        const header = ref<HTMLElement | null>(null);
        const row = ref<HTMLElement | null>(null);
        collapsed = useCollapsingRow(header, row, blocked);
        return () =>
          h("header", { ref: header }, [
            h("a", { href: "/", class: "brand" }, "Home"),
            h("div", { ref: row, class: "row" }, [h("select", { class: "switcher" })]),
          ]);
      },
    });
    const wrapper = mount(Host, { attachTo: document.body });
    let unmounted = false;
    const unmount = wrapper.unmount.bind(wrapper);
    wrapper.unmount = () => {
      if (!unmounted) unmount();
      unmounted = true;
    };
    live.push(wrapper);
    return { wrapper, collapsed: () => collapsed.value };
  }

  test("hides on scroll down, shows on scroll up, one update per frame", () => {
    const { wrapper, collapsed } = mountHost();
    scrollTo(300);
    scrollTo(320);
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(collapsed()).toBe(true);

    scrollTo(250);
    flushFrames();
    expect(collapsed()).toBe(false);
    wrapper.unmount();
  });

  test("stays shown while focus is inside the row, and focus reveals it", async () => {
    const { wrapper, collapsed } = mountHost();
    scrollTo(300);
    flushFrames();
    expect(collapsed()).toBe(true);

    (wrapper.find(".switcher").element as HTMLSelectElement).focus();
    await nextTick();
    expect(collapsed()).toBe(false);

    scrollTo(600);
    flushFrames();
    expect(collapsed()).toBe(false);
    wrapper.unmount();
  });

  test("does nothing above 480px", () => {
    phone = false;
    const { wrapper, collapsed } = mountHost();
    scrollTo(600);
    flushFrames();
    expect(collapsed()).toBe(false);
    wrapper.unmount();
  });

  test("honours the caller's block (drawer or menu open)", () => {
    const { wrapper, collapsed } = mountHost(() => true);
    scrollTo(600);
    flushFrames();
    expect(collapsed()).toBe(false);
    wrapper.unmount();
  });

  test("removes its listeners on unmount", () => {
    const { wrapper, collapsed } = mountHost();
    wrapper.unmount();
    expect(mqListeners.size).toBe(0);
    scrollTo(600);
    expect(frames).toHaveLength(0);
    expect(collapsed()).toBe(false);
  });
});
