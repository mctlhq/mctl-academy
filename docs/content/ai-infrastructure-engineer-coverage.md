# AI Infrastructure Engineer: source coverage

Reviewed 2026-11-14 against `https://docs.nebius.com/llms.txt` and
`https://docs.tokenfactory.nebius.com/llms.txt`. The machine-readable plan is
`content/coverage/ai-infrastructure-engineer.yaml`; `lint:content` checks it
against the course map, the allowlist and the source records.

This is a capture plan, not evidence. No item may cite a page until
`capture-sources.yml` has minted its record.

## Counts

| | Objectives |
|---|---|
| Strong | 12 |
| Partial | 10 |
| Missing (held) | 1 |
| **Total** | **23** |

The plan names 77 unique pages. 23 of them are already captured and reused
(`existing:`); the other 54 are new rows in `content/capture-manifest.yaml`,
batches `q4-01` to `q4-11`, which the Solutions Architect course shares.

## At risk

- **`ie-gpu-partitioning` is held.** No allowlisted host documents MIG, MPS or
  time-slicing, and `docs.nvidia.com` is pending a retention review. The
  objective stays in the map but is out of author scope. Domain 3 has 6 mock
  slots across the 4 remaining objectives.
- **Partial, author only what is documented:** `ie-checkpoint-restart`
  (restart mechanics, not framework checkpointing),
  `ie-distributed-parallelism` (launchers and scheduling, not FSDP or
  DeepSpeed), `ie-inference-pipelines`, `ie-marketplace-apps`,
  `ie-serving-patterns`, `ie-inference-slo-tuning` (no latency targets),
  `ie-multicluster-networking`, `ie-fabric-incidents` (no stalled-job runbook),
  `ie-gpu-rollouts` (no migration runbook) and `ie-compliance-residency`
  (certifications are not documented on an allowlisted host).

## Volatile objectives

`ie-billing-quotas`, `ie-compliance-residency`, `ie-training-images`,
`ie-gpu-fabric`, `ie-marketplace-apps`, `ie-inference-slo-tuning`,
`ie-cross-cloud-data` and `ie-gpu-rollouts`. Their pages carry prices, quota
values, region and platform lists, image versions, bandwidth figures or
transfer limits. Items test the mechanism or the trade-off, never the figure.

## Angle rule

CloudOps **diagnoses**, this course **operates and configures**, and Solutions
Architect **chooses and trades off**. A shared page is fine; a question that
asks the other course's question is not.

## Overlap with AI CloudOps Engineer

| Topic | CloudOps record | IE objective | IE asks |
|---|---|---|---|
| InfiniBand fabric | `src-co-gpu-clusters` | `ie-gpu-fabric`, `ie-training-cluster-lifecycle` | which test to run and how to read it |
| Storage types | `src-co-storage-types`, `src-co-storage-manage` | `ie-storage-tiers` | which tier fits the data |
| Quotas | `src-co-compute-quotas` | `ie-billing-quotas` | how to plan and request capacity |
| IdP federation | `src-co-iam-federations` | `ie-identity-federation` | how to set access up |
| CUDA 802 | `src-co-cuda-init-error` | `ie-fabric-incidents` | what the platform team changes afterwards |
| Kubernetes health checks | `src-co-k8s-health-checks` | `ie-long-run-reliability` | how auto-repair is configured |
| VPC isolation | `src-co-vpc-isolation` | `ie-multicluster-networking` | how networks are connected |
| Alerts, LogQL | `src-co-alerts`, `src-co-logs-query-language` | `ie-observability-platform` | how the stack is set up |

## Pairs with AI Solutions Architect

| IE (operate) | SA (choose) |
|---|---|
| `ie-identity-federation` | `sa-identity-model` |
| `ie-billing-quotas` | `sa-finops`, `sa-capacity-quotas-cost` |
| `ie-storage-tiers` | `sa-storage-architecture` |
| `ie-checkpoint-restart` | `sa-checkpoint-strategy` |
| `ie-distributed-parallelism` | `sa-distributed-training` |
| `ie-serving-patterns` | `sa-deployment-shape` |
| `ie-observability-platform` | `sa-observability-scope` |
| `ie-cross-cloud-data` | `sa-multicloud-ingestion` |
| `ie-gpu-fabric` | `sa-validation-acceptance` |
| `ie-gpu-rollouts` | `sa-gpu-selection` |
