# mctl-academy

Free, English-first practice for an agentic AI certification. React/Vite client
and an Express API in one TypeScript container, PostgreSQL on the shared CNPG
cluster, deployed to the `labs` tenant. The application does not exist yet —
Phase 0 is content pipeline and policy.

## Read these before touching content

- `CONTENT-POLICY.md` — **binding.** The maintainer has sat this exam, so
  authorship and approval are separated mechanically: agents write items from
  allowlisted documentation, humans only approve. `authored.by` must be
  `agent:<name>`; the lint enforces it.
- `SOURCES.md` — the source allowlist and the snapshot/evidence rules.
- `LEGAL.md` — naming rules. Certification naming appears in exactly one place,
  `content/branding.yaml`, and never in a slug, title, or question.

## Layout

- `content/schemas/` — versioned JSON Schemas (2020-12). Question, lesson, source.
- `content/branding.yaml` — the only file naming the certification; domain
  weights and the objective map.
- `content/{questions,lessons,sources}/` — YAML content.
- `scripts/validate-content.mjs` — the content lint.
- `tests/content-lint.test.mjs` — proves the lint rejects, rule by rule.

## The gate

Two layers, and the split matters:

1. **JSON Schema** — shape. Four options, status enum, 25-word excerpt cap,
   exactly one correct answer via `minContains`/`maxContains`. This needs ajv's
   **2020-12 build** (`ajv/dist/2020.js`); the default export is draft-07 and
   ignores those keywords silently.
2. **The lint** — cross-file references, the objective map, duplicate option
   text, the agent-authorship rule, and publication preconditions (`reviewed`
   present, source snapshotted, source not drifted).

Verbatim citation verification against the private R2 snapshot is a third,
separate step. It needs secrets, so it cannot run on a fork PR — which is why
content PRs from forks are not accepted.

**An LLM is never the gate.** The mechanical check is. A model reviewing another
model's questions is a second layer at best.

## Commands

```bash
npm ci
npm run lint:content     # structural validation, no secrets, no network
npm run test:content     # 15 tests, each violating one rule
```

## Conventions

- Conventional commits; subject under 72 chars; body explains why.
- **Never commit to `main`.** Branch, PR, merge commit — never squash.
- Branch names must not start with `_` (the review tooling rejects them).
- Semver tags, **no `v` prefix**. Images: `ghcr.io/mctlhq/mctl-academy:{semver}`.
- English everywhere. No emoji. No `Co-Authored-By` trailers.

## Review gates

Content-only PRs are **not** LLM-reviewed — evidence CI plus human CODEOWNER
approval is the gate, and a model judging another model's questions is the loop
this pipeline exists to avoid. Everything else (code, schemas, CI, deployment)
goes through `claude-review.yml`; merge needs no unaddressed P1/P2.

## Deployment

MCP-only, via `mctl_deploy_service` / `mctl_provision_database`. Not yet
onboarded. Two platform constraints shape configuration when it is:

- `env_vars` silently drops any value containing `:` — so no URL or connection
  string may be a plain env var. They go through `secret_env_vars` into Vault.
- `action=deploy` re-renders `values.yaml` and has erased a populated `env:`
  block on a tag bump. Keep `env:` to colon-free scalars.

See `PLAN.md`.
