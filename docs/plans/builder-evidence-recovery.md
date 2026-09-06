# Builder evidence recovery and independent agent review

Accepted 2026-09-05. This supersedes the human-only question approval boundary
in the completed learning-progress plan; GitHub CODEOWNERS/merge gates stay intact.

## Deliverables

- Reassess all 52 quarantined Builder questions. Repair supported concepts from
  allowlisted captured documentation, preserve IDs and attempt history, and leave
  unsupported items in needs_review. Prioritize Mock's deficient domains.
- Permit independent agent approval with honest agent identity and a content
  fingerprint. The editing author cannot approve their own revision. A separate
  reviewer inspects the final question and supporting snapshot and records findings.
- Keep human approvals backward compatible. Stale agent approvals fail lint and
  bundle eligibility. Keep evidence verification and clean-room authorship rules.
- Repair revalidation CLI: explicit question selection, dry-run, fail closed on
  missing excerpts/store errors. Citation matching is not semantic approval.
- Document the existing manual agent/PR authoring process, Capture sources,
  evidence checks, review/promotion, and release boundary. No generation job.

## Verification and delivery

Test approval identity/fingerprints, human compatibility, selection/dry-run and
failure behavior. Verify real snapshot evidence, rebuild the bank, run content
and client checks, report restored/blocked counts and Mock availability.

Work on a feature branch; preserve unrelated local files. Source capture may push
the branch and write snapshots through the existing Capture sources workflow.
No merge, release, branch-protection changes or deployment. Content PRs, when
requested, must contain no more than 20 questions each.

## Status

Implementation of the review and operations safeguards is complete. The retired
question-author/DocsDeltaWorkflow was not a working production population job;
historic banks were authored in agent-led commit/PR batches. Twenty-three source
pages were captured for recovery. Question rewriting and independent final review
remain intentionally separate follow-up work; no quarantined item was published.
