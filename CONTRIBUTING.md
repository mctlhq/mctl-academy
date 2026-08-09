# Contributing

Thanks for looking. Here is what is open, what is closed, and why.

## Open to everyone

- **Issues and bug reports.**
- **Question reports** — if a published question is wrong, ambiguous, or its
  citation does not support it, report it. This is the most useful thing an
  outside contributor can do.
- **Code pull requests** — application code, schemas, CI, tooling.

## Closed at MVP: content pull requests from forks

This is a technical limitation, not a judgment about contributors.

Every question must cite a source, and CI verifies that the citation occurs
**verbatim** in a privately stored snapshot of that source. That check needs
credentials for the snapshot store, and **GitHub does not expose repository
secrets to workflows triggered from a fork.** A content PR from a fork would
therefore skip the one check that makes the citation meaningful.

An unenforceable gate is worse than an honest policy, so content changes come
from maintainer and agent branches inside this repository. If you have a
correction to a question, open an issue — that path works and it gets fixed.

## Clean-room rules

If you contribute anything under `content/`, read
[`CONTENT-POLICY.md`](CONTENT-POLICY.md) first. It is binding.

The short version: content is written from allowlisted public documentation
only. Nothing may originate from anyone's memory of a real exam. Every content
pull request carries an attestation to that effect, and an unchecked attestation
blocks the merge.

## Workflow

Standard for this organization:

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `refactor:`,
  `test:`. Subject under 72 characters; the body explains *why*.
- Never commit to `main`. Branch, open a pull request, merge with a **merge
  commit** — never a squash.
- Branch names: `feat/…`, `fix/…`, `ci/…`, `docs/…`, `chore/…`. Do not start a
  branch name with an underscore; the review tooling rejects it.
- Semantic version tags, **no `v` prefix**: `1.2.0`, not `v1.2.0`.
- English everywhere. No emoji in code or commit messages.

## Review gates

| Change | Gate |
|---|---|
| Application code, schemas, CI, deployment config | Automated review, no unaddressed P1/P2, plus green CI |
| Content | Schema lint, verbatim citation verification, and human approval from a `CODEOWNERS` owner |

Content pull requests are capped at **10 questions**. With a single human
reviewer this is a ceiling on review load rather than an ideal batch size, and
content throughput is the expected bottleneck — small batches keep it moving.

## Local development

The application is live at `academy.mctl.ai` — a Hono API (`server/`) backed
by PostgreSQL, and a Vite + Vue + TypeScript client (`client/`) driven by a
build-time JSON bundle generated from `content/`.

```bash
npm ci
npm run migrate
npm start

cd client
npm ci
npm run dev
```

See the README's "Local development" section for the full command set.
