# Learning progress and content quality

## Accepted behavior

- Progress means latest-correct questions / currently published bank. Show unseen,
  open mistakes, and accuracy on latest attempts separately; no exam-readiness claim.
- Practice selects unseen and latest-incorrect questions. Only the first selection
  in a fresh showing is an attempt. Reading feedback does not resolve a mistake.
  A later incorrect Mock attempt returns a question to practice.
- Persist each device's queue by learner, course, mode, and optional domain.
  Restore question/option order, position, and revealed feedback after navigation,
  refresh, or course switching. Results retain existing account synchronization.
- Show all unanswered questions before existing mistakes (user correction), with one showing per pass.
  Skips are not attempts. Repeat unresolved items in a new pass, never an endless loop.
- Reconcile on resume/advance, preserving the current question during background
  sync. Exclude withdrawn items and append newly eligible questions.
- Completed bank offers Repeat all and Mock without erasing history.
- Domain recommendation uses lowest solved fraction, then highest course weight;
  its link opens the corresponding domain. Make mobile context controls accessible
  from the header, clear of the next-question action.

## Implementation and validation

1. Shared reactive progress statistics and durable practice sessions; regression
   tests for scoring, skip, restoration, course/owner isolation, content withdrawal,
   reset, background updates, and completion.
2. Publish source links and short excerpts in answer feedback, with generated
   artifact validation. No private source snapshots reach the browser.
3. Audit every published Builder question's supplied evidence. Quarantine explicit
   mismatches as needs_review, preserving historical attempts. Record decisions in
   the content audit document; do not fabricate human approval or source hashes.
4. Add an advisory content report for coverage, source/objective mismatch, repeated
   citations, similar questions, answer-length bias, and mock shortfalls. Document
   claim-first authoring and independent evidence-support review before human approval.
5. Run client tests, content tests, typechecks, lint, build, and mobile end-to-end
   checks. Commit only this initiative's files on a feature branch.

## Boundaries

No server API or database migration for the first release. Account-wide session
cursor sync, expanded question banks, new source allowlisting, and lessons are
follow-ups. Existing unowned local attempt history needs a separate explicit-owner
migration; do not infer its owner or erase it. New session keys are owner-scoped.
Human approval remains required before rewritten questions publish.

## Status

First-release implementation complete and locally verified on 2026-09-05.
Existing unrelated local drafts remain untouched. No production deployment made.

- Client: 119 tests passed; content: 107 tests passed; advisory report: 1 test passed.
- Browser: 8 tests passed using the production client build, covering queue
  restoration, unanswered-first selection, progress denominators, completion,
  Mock shortfalls, and widths 375, 390, 768, and 1440 pixels.
- Typechecks, ESLint, content lint, production build, Prettier, and diff checks pass.
- Browser tests stub authentication; live account synchronization, backend/DB
  integration, and private R2 snapshot verification were not exercised here.

Content repair remains a follow-up: see the
[Builder evidence audit](../content/builder-evidence-audit.md) and
[Content operations](../content-operations.md). The 52 quarantined items require
supporting evidence and independent review before republication. Builder currently
has 28 published questions and cannot fill its existing weighted Mock.
