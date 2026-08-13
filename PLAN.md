# mctl Academy — canonical MVP plan (polished)

## Context

The maintainer sat the Nebius Agentic AI Builder certification twice and did not
pass. mctl Academy is the practice tool built in response: a free, English-first,
public learning app at `academy.mctl.ai` with Learn / Practice / Review-mistakes /
Mock modes over an original, evidence-backed question bank.

Two facts drive every design decision below:

1. **The maintainer accepted the Nebius Certification Terms as a candidate and has
   seen real exam items.** The IP clause forbids reproduction, modification, and
   derivative works of exam materials. A course written from public documentation is
   not a derivative work — but anything written from recollection is. Clean-room
   authoring is therefore mandatory, not advisory, and it constrains *who may author
   items* (agents, from documentation excerpts) versus *who may approve them* (the
   maintainer, on evidence criteria only).
2. **Rollout goes through the mctl MCP tools, not through commits to `mctl-gitops`.**
   `mctl_deploy_service` / `mctl_provision_database` own `services/labs/mctl-academy/`
   end to end. This is achievable today, but it imposes hard constraints on
   configuration shape (see "Deployment").
3. **The agent dev-loop runs on Temporal, not on Argo CronWorkflows.** Since
   mctl-agents 1.23.0 the `issue → investigate → approve → implement` path is a
   durable `DevLoopWorkflow` in the `mctl-agents` Temporal namespace. Argo still runs
   the actual agent pods, but it is submitted *from* Temporal activities. This changes
   the intake trigger, the observability surface, and — most consequentially — makes
   proposal approval a **two-step** operation (see section 5).

This document supersedes the earlier draft. Section "Changes from the draft" lists
what was corrected and why, so the deltas are reviewable rather than buried.

---

## Changes from the draft

| # | Draft said | Corrected to | Why |
|---|---|---|---|
| 1 | Deploy via centralized `mctl-gitops` image build + PR | Deploy entirely via mctl MCP (`mctl_deploy_service` onboard/deploy, `mctl_provision_database`) | Explicit user decision; no direct commits to the gitops repo |
| 2 | Env vars set freely | **No colon-bearing value may go through `env_vars`** | `tpl-git-commit.yaml` pipes `KEY=VALUE` through unescaped `yq`; values containing `:` (every URL) are silently dropped. Verified behaviour, not theory |
| 3 | — (unaddressed) | Keep the plain `env:` block near-empty; all real config in Vault via `secret_env_vars` | `mctl_deploy_service action=deploy` re-renders `values.yaml` from a schema and has wiped a 10-key `env:` block on a tag bump before (labs/kuptsi-app 0.1.17→0.2.0, CrashLoopBackOff). Vault-backed `envFrom` survives |
| 4 | Phase 1 exit: "3 full attempts by people who did not author content" | 3 clean end-to-end mock runs by the maintainer + objective defect criteria | Solo project — the original criterion is unsatisfiable. Under clean-room the maintainer never authors item text, so they are a valid taker |
| 5 | Phase 1 exit: 60–80 questions, 30-question mock | Minimum **80**, mock stays 30, bank size disclosed in the UI | At 60 items a 30-question mock is half the bank; two mocks exhaust it. Least-recently-seen ordering cannot hide that |
| 6 | Evidence CI as the hard gate | Same, plus: **content PRs are maintainer/agent-only at MVP** | GitHub does not expose secrets to fork-triggered workflows, so R2-backed citation verification physically cannot run on a fork PR. An unenforceable gate is worse than a declared policy |
| 7 | "Correct answers not returned before submission" listed among security controls | Reclassified as anti-spoiler UX | The repository is public; the answer key is public with it. Stating this plainly prevents anyone designing for secure assessment |
| 8 | Clean-room mentioned | Operationalized: maintainer is not an item author; review checklist has exactly two criteria; PR-template attestation | The one human reviewer has seen the exam. Without a mechanical rule, "does this feel like the real exam?" leaks back in |
| 9 | Expansion gate: 100 mock attempts / 30 unique learners | Gate is "maintainer passes the exam, or 30 days stable operation" | Growth metrics do not fit a personal training tool; they would push toward exactly the SEO/positioning posture the legal analysis says to avoid |
| 10 | — | Content licensing split: code Apache-2.0, `content/` all rights reserved | Chosen by the maintainer. Prevents the bank being forked and republished as a braindump under the project's own name |
| 11 | Register in `SERVICES` + `NON_ROTATING_SERVICES` | Same, and confirmed necessary: `run_issue_poller.py` skips issues whose repo is not in `SERVICES` | Verified in `orchestrator/run_issue_poller.py`; without registration the drift issue is silently dropped |
| 12 | Agent pipeline assumed to be Argo CronWorkflows | Temporal `DevLoopWorkflow`; Argo still runs the pods but is submitted from Temporal activities | mctl-agents 1.23.0 moved dev-loop orchestration to Temporal. Intake latency, observability, and approval semantics all differ |
| 13 | "Drift issue → poller → investigator → implementer" reads as automatic | **Approval is two steps and neither is optional**: a Temporal `approve` signal *and* a `.status.yaml` flip to `accepted` via a gitops PR | Verified in `orchestrator/temporal/workflows/dev_loop.py` and `agents-state/OPERATOR.md`. The signal alone unblocks `wait_condition` but the implement CWFT then **skips silently** with `skipped_reason` — a no-op that looks like success |
| 14 | Drift dedup "handled by workflow id" (per the Temporal memo) | Dedup stays the GitHub Actions workflow's own job, on a deterministic source key | Temporal's `dev-loop-{owner}-{repo}-{issue}` id dedups *workflow starts for one issue*. A weekly job that opens a **new** issue for the same drifted source gets a new number and therefore a new workflow — Temporal never sees the duplicate |
| 15 | Reconcile & Issue Poll cron loops assumed to be Argo CronWorkflows | Migrated to **Temporal Schedules** (`reconcile-mctl-agents-schedule` 15m, `issue-poll-mctl-agents-schedule` 30m) in `mctl-agents` 1.25.0 | All intake, dev-loop, and reconcile loops are Temporal-native. Read-only projections & orphan signals run in Temporal; gitops commits are delegated to Argo CWFTs under mutex |

---

## 1. Positioning and legal posture

- Product name, domain, slugs, URLs, and UI are **mctl Academy** — vendor-neutral.
- "Nebius Agentic AI Builder" appears exactly once, in the course description, plus a
  footer disclaimer: *not affiliated with, endorsed by, or sponsored by Nebius*.
  Never in a URL, slug, page title, logo, or question text. No Nebius branding assets.
- All certification naming, the disclaimer text, and the objective map live in a single
  `content/courses/<id>.yaml`, so switching a course to vendor-neutral naming is a one-file change
  rather than an 80-item rewrite.
- No SEO targeting of certification keywords at MVP.
- A permission/positioning request is sent to Nebius Academy in parallel and tracked in
  a public issue. Launch does not block on the reply; the maintainer accepts the
  residual risk. (Not legal advice.)
- The exam guide PDF is never stored, quoted, cited, embedded, given to an agent, or
  used in review.

## 2. Clean-room content policy — `CONTENT-POLICY.md`

Binding rules, committed in Phase 0:

- **Item text is authored by agents from approved public documentation excerpts only.**
  The maintainer is product owner and reviewer, not an item author.
- **The review checklist has exactly two criteria**: (a) does the cited evidence support
  this statement, (b) is exactly one option best. The criterion "does this resemble the
  real exam" is forbidden — its presence ends clean-room.
- No recording, paraphrasing, or reconstruction of anything seen during a sitting — not
  in the repository, issues, agent prompts, or private notes that later reach a context
  window.
- No tuning distractors from memory.
- A draft that feels familiar from a real sitting is **rejected**, not kept.
- Topic priority comes from published domain weights (20/35/20/25) only.
- Every content PR carries the attestation checkbox: *"No content in this PR is derived
  from, or reconstructed from, actual certification exam items."*

Legitimate use of the maintainer's experience: *what was missing from their preparation*
— depth over recall, scenario tasks over definitions, which domain felt hardest. This
sets lesson build order and question style. It never sets question content.

## 3. Product scope

**In:** one course; 4 domain modules; 12–16 lessons; ≥80 reviewed original questions;
Practice with immediate per-option feedback; 30-question / 60-minute Mock;
Review-mistakes; progress dashboard; per-question report action; GitHub OAuth only.

**Mock composition:** 6/10/6/8 across the four domains (matches 20/35/20/25).
Selection is least-recently-seen with shuffled options. The UI states the current bank
size and does not promise non-repetition.

**Out (explicitly):** confidence/recency Review filters, spaced repetition, Google or
email login, other certifications, labs, billing, certificates, proctoring, and any
learner-facing AI tutor.

**Not a secure assessment.** The repository is public, so the answer key is public.
Withholding answers from the API before submission is anti-spoiler UX, not a security
control, and is documented as such in the README.

## 4. Content model and evidence chain

Content is strict sanitized Markdown — never executable MDX — under `content/`,
validated against versioned JSON Schemas in `content/schemas/`.

Each question carries: stable immutable `id`; `certification` / `domain` / `objective`;
`status` ∈ `draft | needs_review | published | retired`; four unique options; exactly one
correct answer; per-option explanations; authored/reviewed metadata; and source evidence.

Each source record in Git holds: canonical URL, title, retrieval timestamp, SHA-256,
objective mappings, and an evidence excerpt of **at most 25 words**.

**Snapshots.** Full snapshots of allowed sources are stored privately in the Cloudflare
R2 bucket `academy-source-snapshots`, keyed by SHA-256, credentials from Vault. R2 is
already platform infrastructure (the CNPG cluster backs up there). Certification PDFs
are never snapshotted.

**Evidence CI** (hard gate): fetch the immutable snapshot by hash → verify the hash →
assert every evidence excerpt occurs **verbatim** in the snapshot. Missing snapshot or
non-matching excerpt blocks publication and holds the item in `draft`. This mechanical
check is the gate; the LLM verifier agent is a second, softer layer — the platform has a
documented history of agents fabricating version numbers, so LLM-checking-LLM is never
the gate.

**Approved sources** start and, at MVP, end with public `docs.nebius.com`. Any addition
requires explicit allowlisting plus a retention-terms review. An objective with no
approved source stays unpublished.

**Publication.** Git content compiles to an immutable manifest. The publish job is
idempotent: one `content_version` per manifest hash, atomically marked published.
Attempts snapshot rendered text, choices, shuffle order, expected answers, sources,
timestamps, and scoring rules, and reference the version — referenced versions are never
deleted, and retiring an item never mutates a past attempt.

**Drift.** A weekly GitHub Actions workflow in `mctl-academy` re-fetches approved
sources, compares hashes, maps changes to dependent content ids, marks them
`needs_review`, removes them from new selection, and opens **one** `agents:intake` issue
per drifted source. Existing attempts are untouched.

Dedup is this workflow's own responsibility and must not be delegated to Temporal.
Each issue title carries a deterministic key — `drift: <source-id>` — and the job
searches open issues for that exact key before acting: found → append a comment with the
new hash and re-apply the label; not found → open a new issue. Temporal's workflow-id
dedup (`dev-loop-{owner}-{repo}-{issue}`) is keyed on the *issue number*, so it prevents
two `DevLoopWorkflow`s for the same issue but does nothing about a second issue for the
same source.

Intake latency after the issue is opened is a Temporal Schedule tick — minutes, not the
next Argo cron hour.

## 5. Agents and PR flow (Temporal dev-loop)

### Registration

- Add `mctl-academy` to `SERVICES` **and** `NON_ROTATING_SERVICES` in
  `mctl-agents/config/settings.py`. Registration in `SERVICES` is required for
  `run_issue_poller.py` to dispatch the drift issue at all; membership in
  `NON_ROTATING_SERVICES` keeps it out of the researcher/CVE rotation, which is
  irrelevant here and would need an `agents/mctl-academy/` scaffold that will not be
  created.
- Create `platform-gitops/agents-state/mctl-academy/` in mctl-gitops. The implement CWFT
  only considers proposals under `agents-state/<service>/`; the directory does not exist
  yet (verified — thirteen services are present, Academy is not among them).
- Add `mctl-academy` to `SHEPHERD_SKIP_SERVICES`, still read at
  `orchestrator/run_shepherd.py:146`. The variable is unchanged, but its context is: the
  shepherd now runs inside the Temporal review loop rather than as a standalone
  CronWorkflow.
- **No agent-registry entry is required.** `resolve_agent_release` returns `None` — not
  an error — for an agent never promoted, and `DevLoopWorkflow` falls back to the target
  CWFT's baked-in default image. `mctl_create_agent` / `mctl_promote_agent` are
  therefore optional, not a prerequisite.

### The path an intake issue actually takes

```
drift GHA → issue (label agents:intake)
          → run_issue_poller.py: gh search + Temporal RPC (no SDK spend here)
          → DevLoopWorkflow  id = dev-loop-mctlhq-mctl-academy-<issue>
             ├─ resolve_agent_release("issue-investigator")   [Temporal activity]
             ├─ submit_and_wait CWFT mctl-agents-investigate  [Argo pod]
             ├─ wait_condition(approved)  ← durable, can sit for days
             └─ submit_and_wait CWFT mctl-agents-implement    [Argo pod] → PR
```

### Approval is two steps, and skipping either fails silently

This is the sharpest edge in the whole pipeline and the plan previously implied a single
automatic transition:

1. **Temporal signal** — `python -m orchestrator.temporal.cli approve
   dev-loop-mctlhq-mctl-academy-<issue>`. Unblocks `wait_condition` only.
2. **Proposal status flip** — `.status.yaml` `proposed → accepted` under
   `agents-state/mctl-academy/proposals/<slug>/`, via a normal gitops PR.

The implement CWFT triggers on `status: accepted` alone. Signal without flip → the CWFT
runs, finds nothing accepted, and exits with `skipped_reason` — a **successful-looking
no-op**, not an error. Flip without signal → the workflow sits at `wait_condition`
forever. Both must happen; order does not matter.

Note the boundary this draws against the MCP-only rule: **deployment** stays MCP-only,
but **proposal approval is inherently a gitops PR** — a one-line status change, reviewed
like any other. That is by design (Argo holds the `mctl-gitops-main-writes` mutex, so the
automated flip is deferred to a later phase), not a gap in this plan.

### Content PR pipeline

`source researcher → writer agent → deterministic evidence CI → human CODEOWNER
approval`. Agent output is limited to issues and PRs.

The earlier draft placed an "assessment-editor agent" between CI and human approval
without defining it. Dropped for MVP: with one human reviewer and a mechanical evidence
gate, a second LLM pass adds cost and a false sense of verification without adding a
check the gate does not already make. Revisit only if the audit finds a defect class CI
cannot catch.

- Content-only PRs are capped at 10 questions. At ≥80 questions that is ≥8 review cycles
  by a solo maintainer — the cap is a ceiling on review load, not an optimum, and content
  throughput is the expected Phase 1 bottleneck.
- Automated code review (`claude-review.yml`) applies to PRs touching application code,
  schemas, CI, or deployment config — not to content-only PRs, which are gated by
  evidence CI plus human approval.
- **External contributions at MVP:** issues, bug reports, and question reports are open;
  code PRs from forks are accepted; **content PRs from forks are not** — evidence CI
  cannot receive R2 credentials on a fork-triggered run. Stated in `CONTRIBUTING.md`.

### Platform prerequisites — already satisfied, verify before relying on them

- `services/admins/mctl-agents-worker/values.yaml` → `image.tag: "1.23.0"` ✓
- Temporal namespace `mctl-agents` registered (`register_ns mctl-agents 30` in
  `infra-components/data/temporal/tenant-namespace-job.yaml`) ✓
- The legacy CronWorkflows (`issue-poll`, `implement`, `shepherd`, `incidents`,
  `reconcile`) are still in the repo. This is not a blocker: the cron path runs the same
  poller, which dispatches into Temporal, and `WorkflowAlreadyStartedError` is handled —
  so double intake collapses to one workflow rather than two runs.

## 6. Repository bootstrap — `mctlhq/mctl-academy` (public)

Standard workspace conventions apply: conventional commits, no direct commits to `main`,
feature branch → PR → merge commit (never squash), semver tags with **no** `v` prefix,
images at `ghcr.io/mctlhq/mctl-academy:{semver}`, English everywhere, no emoji.

Files at Phase 0:

- `PLAN.md` (this document), `CONTENT-POLICY.md`, `SOURCES.md` (allowlist + retention),
  `LEGAL.md` (positioning, disclaimer, permission-request status)
- `LICENSE` — Apache-2.0 for code; `content/LICENSE` — **all rights reserved**, with the
  split stated in the README
- `PRIVACY.md` — data minimization: store GitHub numeric id and login only, no email, no
  analytics at MVP; account deletion cascades to attempts
- `CODEOWNERS` (maintainer owns `content/**` and `**/schemas/**`), branch protection,
  PR template with the clean-room attestation
- `.github/workflows/`: `ci.yml`, `content-lint.yml` (schema, no secrets),
  `content-evidence.yml` (R2, in-repo branches only), `source-drift.yml` (weekly),
  `claude-review.yml`, release-please
- Gotchas to respect: branch names must not start with `_` (claude-review rejects them
  behind a misleading "directory mismatch" error); release-please needs the GitHub App
  token and merges with `--admin`; `claude-review.yml` needs `allowed_bots` for
  agent-actor PRs.

## 7. Application

**Built, with one stack change from the original design below:** the client
is Vue, not React, and the API is Hono, not Express — otherwise as planned.

Single TypeScript container: client built to static assets, served by the API
process alongside it. PostgreSQL on the shared CNPG cluster.

Core tables: `users`, `content_versions`, `questions` (snapshot-referenced),
`attempts` (immutable), `attempt_items`, `question_reports`.

Security and session handling:

- GitHub OAuth with minimal scopes, OAuth `state` and PKCE where supported, callback
  allowlist
- Secure `HttpOnly` `SameSite` cookies, CSRF protection, session rotation on login
- **Server-side UTC `started_at` / `expires_at`**; post-deadline scoring is decided
  solely by server receipt time — the client clock is never trusted
- Rate limits on submission and report endpoints; account and session deletion
- **Question reports stay anonymous by design**: `POST /api/reports` accepts
  unauthenticated callers (Practice mode itself doesn't require sign-in, so
  gating reports behind a session would suppress them from exactly the
  learners most likely to hit a bad question) and never records a reporter
  identifier, even though `question_reports.reporter_user_id` exists for a
  possible future moderator-linked flow. Abuse is bounded instead by
  `requireSameOrigin`, the per-client rate limit, question ID validation
  against the published bundle, and the comment length cap — not by
  authentication.
- **The rate limiter trusts only `CF-Connecting-IP`** as client identity.
  `academy.mctl.ai` is fronted by Cloudflare, which unconditionally
  overwrites that header with the TCP peer it saw — a client cannot forge
  it. `X-Forwarded-For` is not trusted for the same purpose: a reverse proxy
  typically only appends to it, so a client-supplied prefix survives
  untouched, which previously let any caller pick its own bucket (or a
  fresh one per request) at will. Requests with no trusted IP header share
  one dedicated fallback bucket, keyed by a `Symbol` so no header value —
  including the literal string `"unknown"` — can collide with it. The
  in-memory store is capacity-bounded (`RATE_LIMIT_MAX_ENTRIES`); at
  capacity it sweeps expired entries first and only then fails closed
  (`429`) rather than evicting another client's still-active window.

## 8. Deployment — MCP-only, no gitops commits

**Done.** Onboarded to `labs`, live at `academy.mctl.ai`. Verified via
`mctl_get_service_status`: ArgoCD Healthy/Synced, database provisioned,
`AUTH_ENABLED`/`PUBLIC_ROUTES_ENABLED` both `true` in production. The
bootstrap order below is kept as a record of how it was done and as the
reference for the same steps on a future service, not as a pending task.

Target tenant `labs`. Capacity checked: 11/15 services used (Academy → 12), `pods: 25`,
tenant PVC quota untouched because CNPG is a shared cluster in its own namespace.
Requests `50m` / `128Mi`, limits `200m` / `512Mi` — well inside the LimitRange
(`max 3 CPU / 3Gi`) and the tenant quotas (`requests.cpu 3`, `requests.memory 5Gi`).

**Configuration shape is dictated by two verified platform bugs:**

1. `env_vars` silently drops any value containing `:`. Therefore **no URL, no
   connection string, and no issuer may be passed as a plain env var.**
2. `mctl_deploy_service action=deploy` re-renders `values.yaml` from a schema and has
   erased a populated `env:` block on a tag bump.

Consequently: the plain `env:` block holds only colon-free scalars (`NODE_ENV`,
`PORT`, feature flags). Everything else — the OAuth client id/secret, the callback URL,
the public base URL — goes through `secret_env_vars`, which the workflow writes to Vault
at `teams/labs/mctl-academy` and wires into the pod as an ExternalSecret + `envFrom`.
That path is both colon-safe and stomp-safe. `DATABASE_URL` arrives from
`mctl_provision_database` as its own `envFrom` secret. Where a value can be derived at
runtime from the request origin instead of configured, prefer that.

Bootstrap order:

1. `mctl_deploy_service` `action=onboard`, `team_name=labs`,
   `component_name=mctl-academy`, `component_type=base-service`,
   `dockerfile_repo=mctlhq/mctl-academy`, `git_tag=0.1.0`, `port=8080`.
   `dockerfile_repo` must be non-empty or the build step is skipped and the pod lands in
   `ImagePullBackOff`. First image serves only the landing page and `/healthz` —
   `AUTH_ENABLED=false`, `PUBLIC_ROUTES_ENABLED=false` — so an unauthenticated public URL
   never exposes learner routes.
2. `mctl_provision_database` — separate call; onboarding does not provision it.
3. Wait for ArgoCD sync (~3 min) before the next workflow submission.
4. `mctl_add_custom_domain` + `mctl_verify_domain` for `academy.mctl.ai`.
5. Create the GitHub OAuth App with production **and** `localhost` callbacks.
6. `mctl_deploy_service` `action=update-config` with `secret_env_vars` carrying the OAuth
   client id/secret and callback URL → Vault → ExternalSecret.
7. Flip `AUTH_ENABLED` / `PUBLIC_ROUTES_ENABLED` to `true` via `update-config`.
8. After every subsequent tag bump, verify the resulting `values.yaml` diff — read-only —
   for a stomped `env:` block.

## 9. Verification

**Application tests:** immutable attempts (a retired or edited question does not mutate a
past attempt); server-side expiry (submission after `expires_at` scores as expired even
with a skewed client clock); option shuffling; duplicate submission is idempotent;
refresh / network-drop recovery mid-mock; OAuth and session expiry; CSRF rejection;
account deletion cascade.

**Content-pipeline tests:** a question whose excerpt does not occur verbatim in the R2
snapshot fails CI; a missing snapshot fails CI; a hash mismatch fails CI; a drifted
source marks dependents `needs_review`, removes them from selection, and opens exactly
one issue (**re-running the weekly job on the same drifted source comments on the
existing issue instead of opening a second** — the dedup test that Temporal does not
cover); a source becoming unavailable degrades gracefully.

**Agent-pipeline verification (no kubectl):** Temporal UI shows one `DevLoopWorkflow` per
intake issue, id `dev-loop-mctlhq-mctl-academy-<issue>`;
`mctl_list_agent_executions` shows the investigate and implement executions;
`mctl_get_workflow_status` / `mctl_get_workflow_logs` for the Argo runs the activities
submitted. Explicitly test the silent-no-op edge: signal `approve` **without** flipping
`.status.yaml` and confirm the implement CWFT reports `skipped_reason` — so the operator
learns to recognise it before it happens on real content.

**Deployment verification (read-only MCP):** `mctl_get_service_status labs/mctl-academy`
reaches Healthy; `mctl_get_service_logs` shows a clean boot; `mctl_get_workflow_status`
for each deploy workflow; `mctl_get_service_config` confirms every expected key is
present after each `update-config` — specifically that no colon-bearing value vanished.

## 10. Multi-Certification Suite & Documentation-Delta Pipeline

The platform is designed to support the three live Nebius certifications:
1. **AI Leader** (`ai-leader`)
2. **AI CloudOps Engineer** (`ai-cloudops-engineer`)
3. **Agentic AI Builder** (`agentic-ai-builder`)

### Automated Question Authoring & Change Sync (`Nebius Docs Sync`)
- **Discovery**: Driven by canonical `llms.txt` indices (`docs.tokenfactory.nebius.com/llms.txt` and `docs.nebius.com/llms.txt`) and high-signal `docs.nebius.com/changelog`.
- **Fail-Closed Drift Quarantine**: Hash mismatches automatically transition `source.yaml` to `drifted` and questions to `needs_review`, immediately excluding them from learner selection.
- **Evidence Snapshot Pinning**: Question evidence records pin the exact `source_sha256` snapshot hash supporting the claim.
- **Lifecycle & Promotion**: Agent-created questions enter status `review_ready`, pass Evidence CI, and require maintainer Clean-Room promotion before transitioning to `published`.

after the maintainer passes the exam, or after 30 days of stable operation with a
question-report rate below 3% and median content-PR approval under 7 days — whichever
comes first. Not part of this plan.
