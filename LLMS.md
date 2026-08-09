# LLMS.md — mctl-academy Certification Platform

> `mctl-academy` is an evidence-backed practice platform for agentic AI certification. Built with Bun, Hono API server, React/Vite frontend, and PostgreSQL on CNPG.

## Key Rules & Content Policy

- `CONTENT-POLICY.md`: Authorship and approval are mechanically separated. Questions must be written by AI agents from allowlisted documentation (`authored.by: agent:<name>`) and approved by human reviewers.
- `LEGAL.md`: Certification naming rules. Naming is strictly isolated to each course's canonical `content/courses/<id>.yaml` and never appears in slugs, titles, nav labels, or questions.

## Structure

- `content/schemas/`: 2020-12 JSON Schemas for questions, lessons, and sources.
- `content/questions/`: YAML question items with evidence citations.
- `server/`: Hono REST API server running on Bun.
- `client/`: React / Vite frontend application.
- `scripts/`: Content validation (`validate-content.mjs`) and evidence verification (`verify-evidence.mjs`).

## Commands

```bash
bun run lint:content    # Structural validation
bun run test:content    # Rule violation test suite
bun run test:server     # Hono API server tests
```
