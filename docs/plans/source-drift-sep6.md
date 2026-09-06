# Source drift recovery, 2026-09-06

Recover the 22 published items withdrawn by #228 after eight documentation pages
changed. Two independent content branches keep each PR below the 20-question cap:
CloudOps (seven sources, ten questions) and inference (one source, twelve questions).

Capture real source bytes through Capture sources, retain historical provenance,
check each full question against the fresh snapshot, and have a separate agent
review the final revision. Record receipts, promote explicit approved IDs, rebuild
bundles and verify content/Mock composition and Evidence CI. Keep unrelated local
work and the older semantic quarantine intact. Deliver reviewable PRs; merge,
release and deployment are outside this stage.

Audit details: [CloudOps](../content/cloudops-drift-sep6.md) and
[inference](../content/inference-drift-sep6.md). The CloudOps document is delivered
by the parallel CloudOps recovery PR.

Status: all eight sources captured; all 22 final revisions independently approved
with committed receipts and promoted. Content lint and 140 content tests pass on
each branch. Local inference client build passes. PR Evidence CI and repository
review gates remain required before merge; no release or deployment is included.
