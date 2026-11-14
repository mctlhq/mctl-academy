# AI Solutions Architect: source coverage

Reviewed 2026-11-14 against `https://docs.nebius.com/llms.txt` and
`https://docs.tokenfactory.nebius.com/llms.txt`. The machine-readable plan is
`content/coverage/ai-solutions-architect.yaml`; `lint:content` checks it
against the course map, the allowlist and the source records.

This is a capture plan, not evidence. No item may cite a page until
`capture-sources.yml` has minted its record.

## Counts

| | Objectives |
|---|---|
| Strong | 11 |
| Partial | 11 |
| Missing (held) | 0 |
| **Total** | **22** |

The plan names 66 unique pages. 17 of them are already captured and reused
(`existing:`); the other 49 are new rows in `content/capture-manifest.yaml`,
batches `q4-01` to `q4-11`, which the Infrastructure Engineer course shares.

## At risk

- **No objective is held.** The two that the earlier audit could not source were
  reworded in the course map to their documented scope:
  `sa-tenant-isolation-least-privilege` (shared responsibility is not
  documented) and `sa-data-lifecycle-investigation` (data classification and
  incident-response process are not documented).
- **Partial, author only what is documented:** `sa-training-stack` (no
  reference stack), `sa-distributed-training` (no parallelism strategies),
  `sa-checkpoint-strategy` (no checkpoint frequency guidance),
  `sa-validation-acceptance` (no acceptance criteria), `sa-failure-support-model`
  (no SLA terms), `sa-migration-handover`, `sa-reuse-automation` (only two
  pages), `sa-right-sizing`, `sa-private-connectivity`,
  `sa-secrets-audit-compliance` (no certifications) and
  `sa-data-lifecycle-investigation`.

## Volatile objectives

`sa-gpu-selection`, `sa-cost-tradeoffs` and `sa-capacity-quotas-cost` are the
heaviest: GPU tables, prices and commitment terms change often. Also
`sa-validation-acceptance` (benchmark figures) and `sa-right-sizing` (VM type
tables). Avoid tables and prices; test the selection and trade-off logic.

## Angle rule

CloudOps **diagnoses**, Infrastructure Engineer **operates and configures**, and
this course **chooses and trades off**. A question that asks for a procedure or
a fix belongs to one of the other two.

## Overlap with AI CloudOps Engineer

| Topic | CloudOps record | SA objective | SA asks |
|---|---|---|---|
| InfiniBand fabric | `src-co-gpu-clusters` | `sa-distributed-training` | when topology matters to the design |
| Storage types | `src-co-storage-types` | `sa-storage-architecture` | which mix of tiers, at what cost |
| Quotas | `src-co-compute-quotas` | `sa-capacity-quotas-cost` | on-demand vs reserved vs committed |
| IdP federation | `src-co-iam-federations` | `sa-identity-model` | which identity model fits the tenant |
| Kubernetes health checks | `src-co-k8s-health-checks` | `sa-failure-support-model` | who recovers what |
| VPC isolation | `src-co-vpc-isolation`, `src-co-vpc-security-groups` | `sa-tenant-isolation-least-privilege`, `sa-private-connectivity` | how to isolate tenants |
| Alerts, metrics | `src-co-prometheus` | `sa-observability-scope` | what must be observed |

CUDA 802 and LogQL have no SA objective.

## Pairs with AI Infrastructure Engineer

See the pair table in `docs/content/ai-infrastructure-engineer-coverage.md`.
Shared pages carry one manifest row with a `coverage` entry per course, so a
record knows which course objective it supports.
