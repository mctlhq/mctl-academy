## What and why

<!-- What changes, and what problem it solves. The "why" matters more than the "what". -->

## Content attestation

<!--
Required for any PR touching content/. Delete this whole section for
code-only, CI-only, or docs-only changes.

This is not a formality. The maintainer of this project has sat the
certification exam this course prepares for, which makes provenance a real
constraint rather than a theoretical one. See CONTENT-POLICY.md.
-->

- [ ] **No content in this PR is derived from, or reconstructed from, actual
      certification exam items.**
- [ ] Every question cites an allowlisted source from `SOURCES.md`.
- [ ] Every evidence excerpt is at most 25 words and occurs verbatim in the
      cited source.
- [ ] Reviewed against exactly two criteria: (a) the cited evidence supports the
      statement, (b) exactly one option is best. Resemblance to the real exam was
      **not** used as a criterion.
- [ ] This PR contains at most 10 questions.

## Checks

- [ ] CI is green
- [ ] Conventional commit subject, under 72 characters
- [ ] Merging with a merge commit, not a squash
