# Content policy

This policy is binding on every contributor, reviewer, and agent that touches
anything under `content/`. It exists because the maintainer of this project has
sat the certification exam that this course prepares for, and has therefore both
accepted the certification terms of service and seen real exam items.

Nothing in this repository may originate from that experience.

## The line this policy draws

A course written from public documentation is original work. A question written
from somebody's memory of a real exam item is a reconstruction of that item — it
is the thing certification terms of service prohibit, and it is what turns a
study tool into a braindump.

The difference is not one of intent. It is one of provenance. This policy
therefore controls provenance mechanically rather than relying on good faith.

## Authorship

**Item text is authored by agents, from approved public documentation excerpts
only.** The list of approved sources is `SOURCES.md`.

**The maintainer is product owner and reviewer, not an item author.** This
separation is the whole point: the person who has seen the exam does not write
the questions, and the process that writes the questions has never seen it.

## Review

**The review checklist has exactly two criteria:**

1. Does the cited evidence support this statement?
2. Is exactly one option best?

That is the complete list. In particular, **"does this resemble the real exam?"
is forbidden as a review criterion.** The moment resemblance to a real exam
becomes a quality signal, clean-room authoring has ended, regardless of how the
item was originally drafted.

## Prohibited, without exception

- Recording, paraphrasing, or reconstructing anything seen during a sitting —
  in the repository, in issues, in pull request descriptions, in agent prompts,
  or in private notes that may later reach a model's context window.
- Tuning distractors from memory ("there was a similar trap").
- Using recollection to decide which objectives get more questions.

**A draft that feels familiar from a real sitting is rejected, not kept.**
Familiarity is a signal that the item may have converged on a real one; it is
never a reason to prefer it.

## Topic priority

Coverage is allocated from the **published domain weights only** (20 / 35 / 20 /
25). Personal recollection of what appeared on a sitting never influences
weighting.

## Legitimate use of exam experience

The maintainer's experience is a genuine and valuable product signal at exactly
one level of abstraction: **what was missing from their preparation.** Depth
rather than recall. Scenario reasoning rather than definitions. Practice rather
than reading. Which domain felt hardest to prepare for.

This shapes lesson build order and question style.

It never shapes question content.

The test to apply: you may describe **your own preparation process**. You may not
describe **the exam's contents**.

## Attestation

Every pull request that touches `content/` must carry the attestation from the
pull request template:

> No content in this PR is derived from, or reconstructed from, actual
> certification exam items.

An unchecked attestation blocks the merge. This is cheap to sign and cheap to
verify, and it is the artifact that distinguishes a good-faith project from a
braindump if anyone ever asks.
