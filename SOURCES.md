# Approved sources

Content may only be derived from sources on this allowlist. A source that is not
listed here cannot be cited, and an objective with no approved source stays
unpublished rather than being covered from general knowledge.

## Allowlist

| Source | Scope | Retention | Approved |
|---|---|---|---|
| `docs.nebius.com` | Public product documentation | Snapshot to private R2 | 2026-08-06 |

That is the complete list at MVP. It is deliberately short.

## Explicitly not sources

| Excluded | Reason |
|---|---|
| Certification exam guide PDF | Exam material; see `LEGAL.md` |
| Any exam simulator, braindump, or question bank | Provenance cannot be established |
| Recollection of a real sitting | Prohibited by `CONTENT-POLICY.md` |
| Community forum posts, blogs, videos | Not authoritative; no retention terms |

## Adding a source

A new source requires all of the following before any content cites it:

1. **Explicit allowlisting** — a pull request adding a row to the table above.
2. **Retention-terms review** — confirmation that storing a snapshot is
   compatible with the source's own terms. Recorded in the PR description.
3. **A stated scope** — which parts of the source are in bounds. "The whole
   site" is an acceptable scope only if the retention review covers it.

Sources are added one at a time, with reasoning. A source that cannot clear the
retention review can still be *read* by a human for orientation, but nothing may
cite it and nothing may be snapshotted from it.

## Evidence records

Each source record committed under `content/` holds:

- canonical URL
- title
- retrieval timestamp (UTC, ISO 8601)
- SHA-256 of the retrieved document
- objective mappings
- an evidence excerpt of **at most 25 words**

The excerpt limit keeps this repository from becoming a mirror of somebody
else's documentation while still pinning each claim to specific wording.

## Snapshots

Full retrieved documents are stored privately in the Cloudflare R2 bucket
`academy-source-snapshots`, keyed by SHA-256, with credentials provisioned from
Vault. Snapshots are never committed to this repository and never served to
learners.

Their only purpose is to make citation verification mechanical: CI fetches the
snapshot by hash and asserts that each evidence excerpt occurs verbatim within
it. Without the snapshot, the citation check would be decorative.

**Certification PDFs are never snapshotted**, regardless of who supplies them.

## Drift

A weekly job re-fetches every allowlisted source and compares hashes. When a
source changes, dependent content is marked `needs_review` and removed from new
Practice and Mock selection until a human re-verifies it. Attempts already taken
are never altered.
