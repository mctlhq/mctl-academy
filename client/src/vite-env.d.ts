/// <reference types="vite/client" />

// Standard Vue 3 + TS shim (the same one create-vue scaffolds into env.d.ts).
// vue-tsc's own .vue-aware resolution is reportedly flaky on some
// bun/musl(Alpine) combinations — reproduced in the oven/bun:1-alpine image
// this repo's Dockerfile builds with, though not on macOS. This ambient
// declaration makes `*.vue` imports resolve unconditionally regardless of
// that platform quirk; it does not weaken vue-tsc's actual type-checking of
// each .vue file's own script block.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
