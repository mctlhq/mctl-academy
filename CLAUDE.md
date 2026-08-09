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
- `LEGAL.md` — naming rules. Certification naming lives only in each course's
  canonical `content/courses/<id>.yaml` (`prepares_for`, `description`,
  `disclaimer`) and never reaches a slug, title, nav label, or question.

## Layout

- `content/schemas/` — versioned JSON Schemas (2020-12). Question, lesson, source.
- `content/courses/*.yaml` — **the** source of truth for course metadata: stable
  course id, vendor-neutral title, domain weights, the objective map, and mock
  composition. One file per course; there is no second catalog anywhere, and
  application code refers to courses by id plus the generated UI metadata below.
- `content/{questions,lessons,sources}/` — YAML content. Each question names its
  course with `course_id`.
- `scripts/validate-content.mjs` — the content lint.
- `scripts/lib/content-model.mjs` — the shared bundle-eligibility rule, used by
  both the lint and the bundle builder.
- `scripts/build-content-bundle.mjs` — generates `client/src/content-bundle.json`
  (eligible published questions) and `client/src/course-catalog.json` (the
  vendor-neutral client course catalog, with each course's published question
  count). Both are regenerated on every dev/build/test run.
- `tests/content-lint.test.mjs` — proves the lint rejects, rule by rule.
- `tests/build-content-bundle.test.mjs` — proves unsafe content cannot reach the
  client bundle.

## The gate

Three layers, and the split matters:

1. **JSON Schema** — shape. Four options, status enum, 25-word excerpt cap,
   exactly one correct answer via `minContains`/`maxContains`. This needs ajv's
   **2020-12 build** (`ajv/dist/2020.js`); the default export is draft-07 and
   ignores those keywords silently.
2. **The lint** — cross-file references, the objective map, duplicate option
   text, the agent-authorship rule, and publication preconditions (`reviewed`
   present, source snapshotted, source neither drifted nor deprecated).
3. **The bundle builder** — the same eligibility rule applied again at the point
   the client artefact is written, so `client/src/content-bundle.json` is safe
   by construction. **No runtime check exists, or should be added.** Nothing in
   the client or the server re-evaluates evidence state, and learner safety
   never depends on a browser network request. Withdrawing an item means marking
   its source in `content/` and redeploying.

Verbatim citation verification against the private R2 snapshot is a further,
separate step. It needs secrets, so it cannot run on a fork PR — which is why
content PRs from forks are not accepted.

**An LLM is never the gate.** The mechanical check is. A model reviewing another
model's questions is a second layer at best.

## Commands

```bash
npm ci
npm run lint:content     # structural validation, no secrets, no network
npm run test:content     # lint + bundle-safety tests, each violating one rule
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

## Attempt immutability

`attempts` is immutable (PLAN.md §7/§9) in the sense that the **application**
never mutates a past attempt row — a retired or edited question does not
rewrite what a learner's historical answer was. That is a different property
from **learner-requested deletion of their own data**: `PRIVACY.md`'s account
deletion already cascades to every attempt, and "Clear history" (`DELETE
/api/attempts`) is the same erasure at a smaller scope, initiated by the data's
owner rather than the system. Attempt immutability prohibits mutation due to
content changes; it does not prohibit explicit learner-requested deletion of
that learner's data. Do not read a hard-DELETE-on-request as an immutability
violation — it is not one.

## Deployment

MCP-only, via `mctl_deploy_service` / `mctl_provision_database`. Not yet
onboarded. Two platform constraints shape configuration when it is:

- `env_vars` silently drops any value containing `:` — so no URL or connection
  string may be a plain env var. They go through `secret_env_vars` into Vault.
- `action=deploy` re-renders `values.yaml` and has erased a populated `env:`
  block on a tag bump. Keep `env:` to colon-free scalars.

See `PLAN.md`.
