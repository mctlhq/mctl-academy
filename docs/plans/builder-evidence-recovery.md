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

Safeguards are implemented, and the lint now also refuses an agent approval whose
receipt is not committed under `docs/content/*-review.json` or is for a different
fingerprint; every approval stamped from 2026-09-06 carries a fingerprint.
Twenty-three source pages were captured; the MCP page failed capture twice and is
not used as evidence.

Batch 1 (this PR, 2026-09-06): all 52 quarantined items were reassessed against the
captured snapshots; 20 were rewritten, independently reviewed by
`agent:claude-reviewer` and published, restoring the Builder Mock (48 published,
no domain shortfall). 21 repairable items are deferred to two follow-up PRs of at
most 20 items (13 domain-4/domain-1, 8 domain-3). 11 items stay `needs_review`
because no captured page establishes them or they duplicate a restored item. The
per-item table is in [the audit](../content/builder-evidence-audit.md).
