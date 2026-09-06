# Content operations

## How the bank was populated

The existing bank was built in agent-led batches, usually one domain or one
course at a time. An authoring agent selected a course objective, wrote YAML
questions from captured allowlisted documentation, and opened a branch/PR.
Structural lint, snapshot evidence verification, bundle generation and a review
of the final question preceded publication. Until 2026-09 this was a manual
batch process with no production cron; the retired `question-author` /
`DocsDeltaWorkflow` in `mctl-agents` was never a production caller.

## Scheduled replenishment

Two workflows in this repository run every Monday:

| Time (UTC) | Workflow | What it does | What it produces |
|---|---|---|---|
| 06:00 | `Source drift` | Re-hashes every recorded source; marks `drifted`, moves dependents to `needs_review`, rebuilds the bundle | One PR on `chore/quarantine-drift` (rebuilt each run) and one `drift: <id>` issue per source, label `content:drift` |
| 06:30 | `Content replenish` | Discovery, capture, authoring, independent review, promotion | One content PR, label `agents:replenish`, for a human to merge |

`Content replenish` (`.github/workflows/content-replenish.yml`) has three jobs:

1. **discover** — `scripts/discover-docs.mjs` parses both `llms.txt` indices,
   lists pages nothing in `content/` cites (ranked toward objectives with gaps
   and each course's primary host), re-checks recorded sources against their
   live bytes, classifies each drifted one with `scripts/detect-docs-delta.mjs`
   against the R2 snapshot, and reports Mock shortfalls and objectives with
   fewer than three published questions. Output: `_run/candidates.json`. The run
   stops here when nothing applies, or when a replenish PR is already open.
2. **author** — an agent (`agent:claude-author`, `claude-sonnet-5`) chooses at
   most `max_new` offered pages and their objectives; `scripts/replenish-prepare.mjs`
   validates the choice against the course maps. The workflow then, on the
   branch and before any agent writes: marks live-drifted sources `drifted` and
   quarantines their published dependents (the same fail-closed step as
   `Source drift`), captures the chosen pages and re-captures drifted sources
   (`scripts/capture-source.mjs`, R2; earlier hashes are kept in the record's
   `versions`), appends manifest rows only for captures that succeeded, stages
   every snapshot under `_run/captured/`, runs `revalidate:content` for quarantined
   items the re-capture repairs, and commits all of that as the base the change
   guard measures the agent against. The agent then writes at most
   `max_questions` `review_ready` items from the captured bytes and may rewrite
   quarantined items whose concept the new text still documents. It cannot
   touch `published` or `retired` files, sources, courses or the manifest; the
   deterministic gates (`lint:content`, `verify:evidence`, the change cap
   counting new files, `test:content`) run after it regardless of what it
   reports.
3. **review** — a separate job, fresh checkout, different model
   (`agent:claude-reviewer`, `claude-opus-5`). It sees the final YAML and
   `_run/captured/*.md`, judges each item on the two CONTENT-POLICY criteria and
   writes `decisions.json`, which must cover exactly the items under review.
   `scripts/review-receipt.mjs` turns that into the committed receipt with
   fingerprints computed from disk; only approved ids are promoted with
   `promote:questions`, and the change guard runs once more afterwards. An id
   re-presented after a later drift supersedes the reviewer's earlier receipt
   entry, so each reviewer holds one decision per id. The author-phase guard
   also refuses any file the agent left `published` or `retired`: only a
   receipt-backed promotion publishes, never the author. Rejected new items are dropped from
   the branch; rejected re-validations return to `needs_review`. The bundle is
   rebuilt and the PR is opened with the `mctl-agents` App token so the usual
   `pull_request` checks (CI, Content evidence) run on it.

What stays manual: merging the PR (CODEOWNER), the exam-provenance attestation
in the PR body, allowlisting a new host, and any `ignored` entry in
`content/discovery-state.yaml` (a page that should never be proposed again).

Dispatch by hand with `gh workflow run content-replenish.yml -f dry_run=true`
to see the candidates without writing anything, or with `-f max_new=1
-f max_questions=5` for a small supervised run. The cap is hard and it is the
agent's: the author-phase guard fails the run when the agent added or changed
more question files than `max_questions`, counting files it created. The
post-promotion guard re-checks that nothing published at the base moved, but
carries no cap, because that set also holds the items the mechanical
re-validation repaired before the agent ran.

A run whose agent writes nothing still opens a PR when the mechanical
re-validation repaired something: those items are real work for the reviewer,
and dropping the branch would leave them quarantined on `main`. A run that only
quarantined does not open one, because `Source drift` already owns that PR.

Every scratch file a run writes lives under `_run/`, which `.gitignore` covers,
and every file an agent writes lives under `_agent/`, which it deliberately does
not: the only `Write` allowlist shape the action honours is `dir/**`.
That is what lets the pre-agent boundary check (`replenish-prepare.mjs
boundary`) be a plain "nothing changed or created outside `content/questions`"
rule rather than a list of filenames that has to be updated whenever a step
starts writing a new one.

## Manual replenishment run

Run on a feature branch, in batches of no more than 20 questions:

```bash
# 1. Add reviewed URL/objective rows to a branch-local capture manifest.
gh workflow run capture-sources.yml --ref <branch> \
  -f manifest=content/capture-manifest.yaml -f only=src-example

# 2. Author YAML from the captured artifact and set status: review_ready.
npm run lint:content
npm run verify:evidence
npm run report:content-quality
npm run test:content

# 3. Ask a different reviewer (human or agent) to inspect the final revision.
# The reviewer receipt contains every selected ID, approved boolean, and the
# questionFingerprint hash. The author cannot approve their own revision.

# 4. Promote only explicit, positively reviewed IDs.
npm run promote:questions -- --by agent:independent-reviewer \
  --review-file review-receipt.json q-xxxxxxxxxxxx

# 5. Rebuild the generated bundle, run client checks, then open a PR.
npm run build:preview
```

Use real R2 credentials for `verify:evidence`; structural lint alone cannot prove
that a citation exists in the private immutable snapshot. Never hand-write a
source hash, reuse an ID for a different concept, or change a question's evidence
just to satisfy a report. Human CODEOWNERS approval of the content PR remains a
separate merge gate.

## Revalidating quarantined items

Revalidation is explicit and fail-closed:

```bash
npm run revalidate:content -- --dry-run q-xxxxxxxxxxxx
npm run revalidate:content -- q-xxxxxxxxxxxx
```

The command only repins an item when every excerpt matches the current captured
snapshot. Missing excerpts, unavailable R2, drifted/deprecated sources, and
semantic mismatches leave the item in `needs_review`. A successful repin removes
old review metadata and returns the item to `review_ready`; it still requires a
fresh independent review before publication.

## Current Builder recovery

Twenty-three official Token Factory documentation pages were captured on the
recovery branch. One MCP page failed capture and remains unreferenced. The 52
old Builder questions were not bulk-promoted: each was reassessed against the
captured text. Batch 1 (PR #221) rewrote and independently reviewed 20 of them,
restoring the Mock; 21 repair candidates follow in two PRs of at most 20 items;
11 stay excluded because no captured page establishes them or they duplicate a
restored item. See the audit for the per-item decisions.

Agent approvals are only valid with a committed receipt: the lint reads
`docs/content/*-review.json` and rejects a `reviewed.by: agent:<name>` whose
receipt is missing, negative, or for another fingerprint.
