// ESLint flat config for the whole repo -- server, scripts and tests (plain
// .mjs on Node) and the Vue client (TypeScript SFCs in a browser).
//
// Deliberately limited to the recommended rule sets. This is the first step
// of the tooling initiative in PLAN.md, and its job is to surface real
// problems -- unused bindings, unreachable code, shadowed globals -- not to
// impose a house style. Formatting is Prettier's job in a later step and is
// not encoded here, so that no rule in this file ever argues with it.
//
// Type-aware linting is likewise left out: the client already runs
// `vue-tsc --noEmit` in CI, which is the stronger check, and enabling the
// type-checked presets here would duplicate it at several times the runtime.
// Type coverage for the .mjs side is a separate, later step (`checkJs`).

import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";

export default [
  {
    // Generated or vendored, never hand-edited: linting it would report
    // problems nobody can fix in place. `client/src/data/` in particular is
    // written by scripts/build-content-bundle.mjs on every build.
    ignores: [
      "**/node_modules/**",
      "client/dist/**",
      "client/src/data/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },

  js.configs.recommended,

  {
    // Node side: the server, the build/content scripts, the migrations and
    // the node:test suites.
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
        // The image runs on Bun and server/index.mjs branches on `Bun` being
        // defined to pick its HTTP server; the same file runs on plain Node
        // in the test suites, which is exactly why the guard exists.
        Bun: "readonly",
      },
    },
  },

  {
    // Playwright specs and config run on Node too, but are TypeScript.
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.vue"],
  })),

  // `flat/essential`, not `flat/recommended`: the recommended tier is mostly
  // the strongly-recommended stylistic rules (attribute-per-line, tag
  // newlines, self-closing style), which on this codebase produced 181
  // warnings and not one genuine defect. Those belong to Prettier, later.
  // Essential is the correctness tier -- missing `key` in `v-for`, mutated
  // props, invalid template syntax.
  ...pluginVue.configs["flat/essential"],

  {
    files: ["client/**/*.{ts,vue}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        // The SFC parser handles <template>; its inner parser has to be the
        // TypeScript one or every `lang="ts"` block fails to parse.
        parser: tseslint.parser,
        ecmaVersion: 2023,
        sourceType: "module",
      },
    },
  },

  {
    // A test may deliberately construct a broken value and never use it, so
    // an underscore prefix is an accepted escape here.
    files: ["tests/**/*.mjs"],
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  {
    // Same escape for the client's Vitest suites -- but via the
    // typescript-eslint rule, not the base one. On TypeScript files the base
    // `no-unused-vars` is switched off by the recommended config precisely
    // because it double-reports (and misreads type-only symbols); re-enabling
    // it here would have reintroduced exactly that.
    files: ["client/**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
