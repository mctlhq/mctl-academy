# Approved sources

Content may only be derived from sources on this allowlist. A source that is not
listed here cannot be cited, and an objective with no approved source stays
unpublished rather than being covered from general knowledge.

## Allowlist

| Source Host | Scope | Retention | Approved Date |
|---|---|---|---|
| `docs.tokenfactory.nebius.com` | Public Token Factory documentation — inference, function calling, structured output, post-training, sandboxes, dedicated endpoints, inference observability, team access and single sign-on, billing and consumption | Snapshot to private R2 | 2026-08-06 |
| `docs.nebius.com` | Public AI Cloud documentation — GPU compute and clusters, Managed Service for Kubernetes, block/shared/object storage, VPC networking and security groups, IAM, projects and federations, Observability (metrics, dashboards, alerts, logs), quotas and limits, node lifecycle and troubleshooting | Snapshot to private R2 | 2026-08-06 |

Scope widened 2026-08-16 (no new hosts) to cover the page families the CloudOps
and Leader banks are authored from. Retention terms were re-confirmed for both
hosts at that time; the pages captured are the same public documentation already
covered by the original 2026-08-06 review.

### Candidates under review
- `docs.tavily.com`: Recommended learning on public certification pages for web search tool integration. Currently **pending retention review** before any content cites it.

## Course-specific source priority matrix

Source priorities are scoped per course, reflecting the public exam bounds:

| Course | Primary Source | Secondary Source | Excluded by default |
|---|---|---|---|
| **Agentic AI Builder** (`agentic-ai-builder`) | `docs.tokenfactory.nebius.com` | `docs.tavily.com` (pending review) | `docs.nebius.com` infrastructure details |
| **AI CloudOps Engineer** (`ai-cloudops-engineer`) | `docs.nebius.com` | `docs.tokenfactory.nebius.com` | Non-cloud developer SDKs |
| **AI Leader** (`ai-leader`) | `docs.tokenfactory.nebius.com` | `docs.nebius.com` (high-level only) | AI Cloud deployment details |

## Discovery & Change Sync (`Nebius Docs Sync`)

Discovery of canonical documentation is driven directly by official Nebius endpoints, not by third-party indices or GitHub release tags:

1. **`https://docs.tokenfactory.nebius.com/llms.txt`**: Canonical index for Token Factory documentation.
2. **`https://docs.nebius.com/llms.txt`**: Canonical index for AI Cloud documentation.
3. **`https://docs.nebius.com/changelog`**: High-signal secondary trigger for major feature additions, deprecations, and breaking changes (read by people; not polled).

`scripts/discover-docs.mjs` (run weekly by the **Content replenish** workflow, see
`docs/content-operations.md`) parses the two indices, fetches each page in its raw
Markdown representation (`.md`) only when it is captured, and proposes pages that no
source record, manifest row or `ignored` entry in `content/discovery-state.yaml`
names. A proposed page becomes a source only through the capture path below; the
discovery report never writes a source record. Context7 and external GitHub
repositories (e.g. `nebius/api`, `nebius/token-factory-cookbook`) may be used as
secondary research tools by agents, but **never** as canonical evidence sources or
authoritative change triggers.

## Explicitly not sources

| Excluded | Reason |
|---|---|
| Certification exam guide PDF | Exam material; strictly prohibited by `LEGAL.md` |
| Any exam simulator, braindump, or question bank | Provenance cannot be established |
| Recollection of a real sitting | Prohibited by `CONTENT-POLICY.md` |
| Community forum posts, blogs, videos | Not authoritative; no retention terms |
| Context7 index | Secondary search layer only; not canonical evidence |

## Adding a source

A new source requires all of the following before any content cites it:

1. **Explicit allowlisting** — a pull request adding a row to the allowlist table.
2. **Retention-terms review** — confirmation that storing a snapshot in R2 is compatible with the source's terms. Recorded in the PR description.
3. **A stated scope** — which parts of the source are in bounds.

Once allowlisted, a page is captured by adding it to `content/capture-manifest.yaml`
and dispatching the **Capture sources** workflow on the branch. That workflow is
the only sanctioned way to mint a source record: `sha256` and `snapshot.key` must
come out of `scripts/capture-source.mjs` actually fetching and hashing the bytes.
A hand-written hash is the exact failure that produced the fabricated CloudOps and
Leader banks — see issues #140 and #141.

To check recorded sources against their live documents without credentials, run
`npm run snapshot:capture -- --check` (exit 0 clean, 2 drifted, 1 unreachable).

## Evidence records

Each source record committed under `content/` holds:

- canonical URL
- title
- retrieval timestamp (UTC, ISO 8601)
- SHA-256 of the retrieved document
- objective mappings
- an evidence excerpt of **at most 25 words**

Question evidence items pin the exact immutable `source_sha256` snapshot hash supporting the claim.

## Snapshots

Full retrieved documents are stored privately in Cloudflare R2 (`academy-source-snapshots`), keyed by SHA-256 hash. Snapshots are never committed to this repository and never served to learners.

CI fetches the snapshot by hash and asserts that each evidence excerpt occurs verbatim within it. **Certification PDFs are never snapshotted.**

## Drift & Fail-Closed Quarantine

When the weekly **Source drift** workflow detects a hash mismatch for an approved source:
1. `source.yaml` status is updated to `drifted`.
2. Dependent published questions transition `published -> needs_review`.
3. Quarantined questions are excluded from new Practice and Mock selection once the
   quarantine PR (`chore/quarantine-drift`) is merged and deployed.
4. Existing completed attempts remain untouched.
5. The next **Content replenish** run re-captures the page, re-validates the items the
   new text still supports, and hands the rest to the authoring agent.

