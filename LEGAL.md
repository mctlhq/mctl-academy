# Legal posture

This document records the project's positioning decisions and the reasoning
behind them. It is a statement of operating policy, not legal advice, and it has
not been reviewed by a lawyer.

## Independence

**mctl Academy is not affiliated with, endorsed by, or sponsored by Nebius, or
by any other certification vendor.**

This disclaimer appears in the application footer, in `README.md`, and on the
course description page. It is not buried in a settings screen.

## Naming rules

The product is **mctl Academy**, at `academy.mctl.ai`. The name, the domain, all
URL slugs, and the user interface are vendor-neutral.

The certification name "Nebius Agentic AI Builder" appears in exactly one place:
the course description, as a statement of what the course prepares for. It is
nominative use — naming a thing in order to refer to it.

It must never appear in:

- a URL or slug
- a page title or meta title
- a logo, favicon, or any image
- question text, option text, or explanation text
- a repository, image, or service name

No vendor branding assets — logos, wordmarks, colors, or design elements — are
used anywhere.

## Search positioning

No SEO targeting of certification keywords at MVP. The project does not compete
for the vendor's search traffic, and does not present itself as an official or
semi-official preparation channel.

## Source material

Content is derived exclusively from the sources allowlisted in `SOURCES.md`,
which at MVP means public product documentation.

**The certification exam guide PDF is never stored, quoted, cited, embedded,
given to an agent, or used in review.** It is not a source. It is not a topic
list. It is out of scope entirely.

The clean-room authoring rules that follow from the maintainer having sat the
exam are in `CONTENT-POLICY.md`, which is the binding document for contributors.

## Permission request

A positioning and permission request has been sent to Nebius Academy, and its
status is tracked in a public issue in this repository.

Launch does not block on a reply. The maintainer has accepted the residual risk
of launching before receiving one, on the reasoning that a course written from
public documentation is original work rather than a derivative of exam
materials.

If the vendor objects, the fallback is a one-file change: all certification
naming, the disclaimer, and the objective map live in `content/branding.yaml`,
so the course can be re-pointed at a vendor-neutral framing without rewriting a
single question.

That fallback being cheap is a deliberate design constraint, not a coincidence.

## What this project does not claim

- It does not claim to reproduce, mirror, or predict the exam.
- It does not claim any pass rate or outcome.
- It does not claim to be a secure or proctored assessment. The repository is
  public and the answer key is public with it; see `README.md`.
