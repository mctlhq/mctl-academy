# Security

## Reporting a vulnerability

Please **do not** open a public issue for a security vulnerability — anything
that could let someone read another learner's data, bypass authentication,
or escalate privileges.

Report it privately instead, via
[GitHub Security Advisories](https://github.com/mctlhq/mctl-academy/security/advisories/new)
for this repository. That opens a private discussion with the maintainer and
lets us coordinate a fix before any public disclosure.

If that form is unavailable, open a minimal public issue asking the
maintainer to reach out for a private channel — do not include exploit
details in it.

## Scope

In scope: the application at `academy.mctl.ai` (`server/`, `client/`) and
this repository's CI/CD configuration.

Out of scope: the content pipeline's evidence gate being bypassable by
someone with write access to this repository — that threat model is covered
by `CONTENT-POLICY.md` and `CODEOWNERS`, not by this document. Third-party
services this project depends on (GitHub, the mctl platform) have their own
reporting channels.

## What to expect

This is a small, mostly single-maintainer project — there is no formal SLA,
but reports are read and triaged as they come in. See `PRIVACY.md` for what
personal data the application stores, which shapes how seriously a given
report is treated.
