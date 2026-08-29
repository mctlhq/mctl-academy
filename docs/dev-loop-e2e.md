# Dev-loop E2E verification record

The mctl-agents dev-loop turns a GitHub issue into a merged pull request
through a fixed chain of stages: issue -> spec proposal -> human approval ->
PR. An issue-investigator reads the issue and writes a requirements/design/
tasks proposal; a human reviews and approves it; an implementer then produces
the PR from the accepted proposal. The pipeline's mechanics, including the
atomic-approve stage, are documented in `mctlhq/mctl-agents` ADR-006.

## Verified runs

| Date | Issue | Pipeline version |
| --- | --- | --- |
| 2026-08-29 | [mctlhq/mctl-academy#212](https://github.com/mctlhq/mctl-academy/issues/212) | mctl-agents 1.30.0 |
