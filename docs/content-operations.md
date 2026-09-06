# Content operations

## How the bank was populated

The existing bank was built in agent-led batches, usually one domain or one
course at a time. An authoring agent selected a course objective, wrote YAML
questions from captured allowlisted documentation, and opened a branch/PR.
Structural lint, snapshot evidence verification, bundle generation and a review
of the final question preceded publication. This was a manual batch process;
there was no reliable production cron that generated and published questions.

The retired `question-author`/`DocsDeltaWorkflow` in `mctl-agents` was never a
production caller. `Source drift` is a different workflow: it detects changed
documentation and quarantines dependent questions. It does not create new items.

## Supported replenishment run

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
