# Approved sources

Content may only be derived from sources on this allowlist. A source that is not
listed here cannot be cited, and an objective with no approved source stays
unpublished rather than being covered from general knowledge.

## Allowlist

| Source Host | Scope | Retention | Approved Date |
|---|---|---|---|
| `docs.tokenfactory.nebius.com` | Public Token Factory documentation — inference, function calling, structured output, post-training, sandboxes, dedicated endpoints | Snapshot to private R2 | 2026-08-06 |
| `docs.nebius.com` | Public AI Cloud documentation — GPU compute, K8s, Storage, IAM, monitoring, node lifecycle | Snapshot to private R2 | 2026-08-06 |

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
3. **`https://docs.nebius.com/changelog`**: High-signal secondary trigger for major feature additions, deprecations, and breaking changes.

Each page discovered in `llms.txt` is fetched in its raw Markdown representation (`.md`). Context7 and external GitHub repositories (e.g. `nebius/api`, `nebius/token-factory-cookbook`) may be used as secondary research tools by agents, but **never** as canonical evidence sources or authoritative change triggers.

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

When `Nebius Docs Sync` detects a hash mismatch for an approved source:
1. `source.yaml` status is automatically updated to `drifted`.
2. Dependent published questions transition `published -> needs_review`.
3. Quarantined questions are immediately excluded from new Practice and Mock selection.
4. Existing completed attempts remain untouched.

