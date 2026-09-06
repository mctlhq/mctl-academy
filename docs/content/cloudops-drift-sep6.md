# CloudOps source drift recovery, 2026-09-06

Scope: seven sources quarantined on main in #228 and their ten formerly
published CloudOps questions. Capture sources run:
https://github.com/mctlhq/mctl-academy/actions/runs/34028854746

All seven captures succeeded; authoring copies were retrieved from the immutable
store by the workflow and downloaded as its artifact. Their SHA-256 hashes match
the generated source records. Historical hashes remain registered in `versions`.

The ten questions retain their concepts and option IDs. Their cited claims still
appear in the new snapshots. `q-co26744a9769` now explicitly requires both test
environments in the same region; previously the distractor proposing different
regions also used separate networks and could satisfy the broad stem. Its
citations now include both the isolation/address-reuse requirements and the
separate-network instruction. No historical learner attempts are changed.

Editing author: `agent:codex-drift-author`. Independent review decisions and
fingerprints are recorded in `cloudops-drift-sep6-review.json`. Publication is
conditional on that review and snapshot Evidence CI. Prometheus and storage
management source records are recaptured too, although they have no affected
question among these ten.

Expected result after publication: CloudOps 40 questions; domain counts
12/10/10/8, meeting the unchanged Mock quotas 9/8/7/6.
