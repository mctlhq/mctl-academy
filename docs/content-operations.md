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

Every scratch file a run writes lives under `_run/`, which `.gitignore` covers.
The agents' own output goes to `_agent/`, which `.gitignore` deliberately does
not cover. Their grant is the **unscoped** `Write` tool: on
`anthropics/claude-code-action` every scoped form tried here was denied at call
time while the step still reported success, so a scoped grant does not narrow
what an agent may write — it stops it writing at all, silently. (One earlier
run accepted `Write(content/questions/**)`; that has never been reproduced and
nothing depends on it.) The workflow
therefore deletes everything but the one expected file straight after each
agent, and the deterministic checks below are the real boundary.

Because the grant reaches every file in the workspace and the deterministic
steps read that same tree, each agent is bracketed. (The CLI confines a bare
`Write` to the working directory — probed in PR #245: `/tmp` was refused with
the same message a rejected pattern produces — so the entries outside the
workspace below are defence in depth against that confinement failing.) The step before it hashes what the steps after it
trust — everything under `_run/`, `.git/config` and `.git/hooks/`, git's three
configuration levels including `$XDG_CONFIG_HOME/git/config`, `~/.npmrc` and
`~/.bunfig.toml`, the `git`/`node`/`bun`/`gh` binaries as they resolve on
`PATH`, and every environment variable (values hashed, so a failure names
variables and prints no secret) — and puts the digest in the step's **output**,
which is not a path an agent can rewrite. The step after it recomputes the
digest before any repository code runs, and separately refuses any `PATH` entry
that was not there before: `$GITHUB_PATH` prepends, so one line appended to it
from inside the agent's step would win every command resolution that follows.
That is what lets the pre-agent boundary check (`replenish-prepare.mjs
boundary`) be a plain "nothing changed or created outside `content/questions`"
rule rather than a list of filenames that has to be updated whenever a step
starts writing a new one.

Both agents run on `CLAUDE_CODE_OAUTH_TOKEN` and retry on
`CLAUDE_CODE_OAUTH_TOKEN_2`, the same pair `claude-review` uses. This is not
politeness about quota: an exhausted token comes back as a *green* step whose
execution output says `is_error` with one turn and no cost, so without the
retry a spent window reads as "the agent had nothing to say" and the run
continues on an empty answer. The retry asks the identical question, starting
from a tree reset to before the interrupted attempt; if neither token can run
the agent, the job fails rather than promoting a partial result. With no second
token configured the workflow still runs — and still fails closed, with a
warning naming the missing secret.

### Running the agents on Nebius Token Factory

`workflow_dispatch` takes a `provider` input. The default, `anthropic`, is what
the Monday cron runs, unchanged. With `provider: nebius` both jobs first start
`scripts/nebius-relay.py` on loopback -- Token Factory speaks OpenAI
chat-completions and the CLI speaks the Anthropic Messages API, so something has
to translate -- point `ANTHROPIC_BASE_URL` at it, and run the author on
`zai-org/GLM-5.3` and the reviewer on `deepseek-ai/DeepSeek-V4-Pro`. It needs one
secret, `NEBIUS_API_KEY`; the step fails loudly rather than falling back when it
is missing.

The agent identifiers move with the models (`agent:glm-author`,
`agent:deepseek-reviewer`). That is not cosmetic: `review-receipt.mjs` stamps the
reviewer id into every approval it records, and a receipt naming a model that did
not do the judging is a false provenance claim, not a label.

Two things this path does not get. Token Factory has no prompt caching, so the
system prompt is paid for in full on every turn. And the OAuth token is
deliberately withheld from the agent steps: it is an Anthropic credential with
no business reaching a third-party endpoint, so a placeholder key stands in,
which the relay ignores.

#### What it costs, measured

One day of this work -- three CI runs plus a local end-to-end run and the model
comparison behind the choice -- billed $37.63 on Token Factory, 2026-09-12:

| Model | Role | Input | Output | Total |
| --- | --- | --- | --- | --- |
| GLM-5.3 | author | $24.63 | $4.72 | **$29.35** |
| DeepSeek-V4-Pro | reviewer | $5.89 | $0.09 | $5.98 |
| others | one-off comparison runs | $2.27 | $0.03 | $2.30 |

The author alone is 78% of it, and five sixths of the author's bill is INPUT.
That is the absence of prompt caching, not the price of the model: Claude Code
re-sends a system prompt describing 255 tools on every turn, and `AUTHOR_TURNS`
is 160 on this path. Cost therefore scales with the turn budget rather than with
the questions produced -- five questions cost roughly thirty dollars, where the
reviewer judged fifty items for six.

The obvious lever is fewer turns, and it pulls against the reason the budgets
were raised in the first place -- a run that finishes over its ceiling is failed,
not truncated -- so it wants measuring rather than guessing. The other lever is
not available at this level: the agent steps already pass four or five tools in
`--allowedTools`, and the relay still logged 253 to 255 tool definitions on every
request, so restricting the grant does not shrink what is sent.

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
