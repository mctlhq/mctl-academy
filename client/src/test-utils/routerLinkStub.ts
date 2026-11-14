import { afterAll, beforeAll } from "vitest";
import { config } from "@vue/test-utils";
import { defineComponent, h, type PropType } from "vue";
import type { RouteLocationRaw } from "vue-router";

/**
 * RouterLink for component tests that mount without a router: renders a plain
 * <a> whose href is the target, so a test can assert where a link goes the
 * same way a learner would see it. Navigation links are real links (not
 * buttons calling router.push), so they need a router or this stub to mount.
 */
export const RouterLinkHrefStub = defineComponent({
  name: "RouterLink",
  props: { to: { type: [String, Object] as PropType<RouteLocationRaw>, required: true } },
  setup(props, { slots }) {
    return () => {
      const to = props.to;
      let href: string;
      if (typeof to === "string") href = to;
      else {
        const path = "path" in to && to.path ? to.path : "";
        const query = new URLSearchParams(
          Object.entries(to.query ?? {}).map(([k, v]) => [k, String(v)]),
        ).toString();
        href = query ? `${path}?${query}` : path;
      }
      return h("a", { href }, slots.default?.());
    };
  },
});

export const routerLinkStubs = { RouterLink: RouterLinkHrefStub };

/**
 * Registers the stub for every mount in the calling test file and restores
 * the previous global stubs afterwards.
 */
export function useRouterLinkStub() {
  let previous: typeof config.global.stubs;
  beforeAll(() => {
    previous = config.global.stubs;
    config.global.stubs = { ...previous, ...routerLinkStubs };
  });
  afterAll(() => {
    config.global.stubs = previous;
  });
}
