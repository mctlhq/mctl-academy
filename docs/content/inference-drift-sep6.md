# Inference overview drift recovery, 2026-09-06

Scope: twelve formerly published questions quarantined by #228, four Builder
and eight Leader questions referencing `src-inference-overview`. Capture run:
https://github.com/mctlhq/mctl-academy/actions/runs/34028868939

The fresh snapshot was captured to R2 and read back into the workflow artifact.
Its SHA-256 matches the new source record; the previous hash remains registered
in `versions` so older quarantined items keep their actual evidence provenance.
Core flavor, model type, and optimization claims remain present in the new text.

All twelve retain their concepts and option IDs. `q-ld3211bef699` explicitly asks
for endpoint configuration factors, removing ambiguity with per-request prompt
length. Its evidence now quotes the actual factor list. `q-ld25f6d73083` cites
the Vision/image-to-text model card instead of a generic introductory heading.
Other question text is unchanged; evidence pins and editing authorship are fresh.

Editing author: `agent:codex-drift-author`. Final independent findings and
fingerprints live in `inference-drift-sep6-review.json`. Existing receipts are
historical; this revision requires the new reviewer's decision. Source capture,
question review and Evidence CI are separate checks.

Expected result after publication: Builder 69 (15/15/18/21 by domain) and Leader
39 (13/10/8/8). Their Mock quotas remain unchanged. The thirteen older Builder
semantic-quarantine questions and the pre-existing Leader review_ready question
are outside this recovery. Historical learner attempts are unchanged.
