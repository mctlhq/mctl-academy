# mctl Academy

Free, English-first practice for agentic AI certification. Every question is
original, and every question cites the public documentation it was written from.

> **mctl Academy is not affiliated with, endorsed by, or sponsored by Nebius, or
> by any other certification vendor.** Courses prepare for live Nebius certifications:
> **AI Leader**, **AI CloudOps Engineer**, and **Agentic AI Builder**.
> They do not reproduce, mirror, or predict those exams. See [`LEGAL.md`](LEGAL.md).

## Why this exists

The maintainer sat the exam twice and did not pass. What was missing was not a
list of topics — it was practice: scenario reasoning instead of recall, and
answers that explain *why* the other three options are wrong.

So the questions here are written from the documentation, each one pinned to the
sentence that supports it, and each option explained.

## Status

Live at [academy.mctl.ai](https://academy.mctl.ai). Sign in with GitHub, then
Practice or take a Mock exam — progress, mistakes, and per-question votes are
saved to your account.

Content coverage varies by course: **Agentic AI Builder** has a published
question bank; **AI CloudOps Engineer** and **AI Leader** are in the catalog
but currently have no published questions (their original source citations
turned out to be fabricated and were pulled — see issues
[#140](https://github.com/mctlhq/mctl-academy/issues/140) and
[#141](https://github.com/mctlhq/mctl-academy/issues/141) — the app hides a
course entirely until it has published content, rather than showing an empty
shell).

This is an actively developing open-source project, not a finished product —
see [Contributing](#contributing) if you want to help.

## Modes

| Mode | What it does |
|---|---|
| **Practice** | Questions with immediate per-option feedback; signed in additionally unlocks per-question voting and persisted progress |
| **Mock** | 30 questions, 60 minutes, weighted 6 / 10 / 6 / 8 across the four domains |
| **Review mistakes** | Every question you've gotten wrong, from Practice or a Mock exam |
| **Learn** | Lessons per objective, built from cited documentation — not yet built |

See [`client/README.md`](client/README.md) for local client development, and
[`PLAN.md`](PLAN.md#7-application) section 7 for the application design.

## This is a study tool, not an assessment

This repository is public, so **the answer key is public with it.** The
application does not return correct answers before a mock is submitted, but that
is spoiler protection, not a security control — anyone can read the answers here.

There is no proctoring, no identity verification, and no certificate. Nothing
produced here is evidence of anything to anyone.

## How the content is made

Questions are drafted by agents from allowlisted public documentation, verified
mechanically, and approved by a human before publication.

1. A researcher agent retrieves an allowlisted source and records its URL,
   title, retrieval time, and SHA-256.
2. A writer agent drafts questions, each carrying an evidence excerpt of at most
   25 words.
3. **CI verifies every excerpt occurs verbatim** in the privately stored snapshot
   of that source. A citation that cannot be verified blocks publication.
4. A human reviews and approves. Only then does the question publish.

The mechanical check is the gate. An LLM checking another LLM's work is not.

Full detail: [`SOURCES.md`](SOURCES.md), [`CONTENT-POLICY.md`](CONTENT-POLICY.md).

## Clean-room authoring

The maintainer has sat this exam, which means they have seen real items and are
bound by the certification terms they accepted. So they do not write the
questions — agents do, from documentation, and the maintainer reviews only
whether the cited evidence supports the claim.

"Does this resemble the real exam?" is explicitly forbidden as a review
criterion. [`CONTENT-POLICY.md`](CONTENT-POLICY.md) is binding on every
contributor.

## Contributing

Issues, bug reports, and question reports are welcome from anyone.

Code pull requests are welcome. **Content pull requests from forks cannot be
accepted** — citation verification needs credentials that GitHub does not expose
to fork-triggered workflows, so the check would be unenforceable. See
[`CONTRIBUTING.md`](CONTRIBUTING.md).

### Local development

`client/` is a Vite + Vue + TypeScript app that reads a build-time JSON
bundle generated from `content/`. `server/` is a Hono API, backed by
PostgreSQL (better-auth for sessions, attempts/votes/reports persistence).
See [`client/README.md`](client/README.md) for client-only setup.

```bash
bun install            # canonical — bun.lock is the lockfile CI installs from.
                        # `npm install` also works (no package-lock.json is
                        # committed, so use install, not ci).
npm run migrate         # apply DB migrations (needs a local Postgres — see .github/workflows/ci.yml)
npm start                # runs server/index.mjs
npm run test:server      # server tests
cd client && bun install && npm run dev   # client dev server
```

## Licensing

Split, deliberately:

- **Code** — Apache-2.0, see [`LICENSE`](LICENSE).
- **Content** (`content/`) — all rights reserved, see
  [`content/LICENSE`](content/LICENSE).

The content is readable in the open but not re-licensable, so the question bank
cannot be forked and republished as a braindump.

## Privacy

No analytics, no third-party scripts, no advertising identifiers, no data
sold or shared. Account deletion cascades to everything. See
[`PRIVACY.md`](PRIVACY.md) for the complete list of what's stored.
