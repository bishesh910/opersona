# Security

opersona holds the most personal thing a product can hold — a model of how
someone thinks — so security reports are welcome and taken seriously.

## Reporting

Please report privately, not in a public issue:
**https://github.com/bishesh910/opersona/security/advisories/new**

Include what you did, what happened, and what you expected. You'll get a reply
within a few days. Please don't test against `opersona.me` with other people's
accounts — run it locally (`pnpm dev`) or against your own workspace.

## What the design already assumes

- **No conversations are stored.** Talking happens on claude.ai; only distilled
  persona memory lives in the database.
- **Every browser→engine call passes one authorization chokepoint**
  (`apps/web/src/lib/engine-authz.ts`): unknown paths 404, cross-tenant access
  404s, owner-only routes stay owner-only.
- **Blind prediction integrity is structural**, not UI-deep: open scenarios are
  served through an explicit column allowlist, and answering is a single
  conditional UPDATE.
- **Inference runs on the user's own Claude** (bridge or their API key); a
  workspace's key is encrypted at rest (AES-256-GCM) and never rendered.
- **Secrets live only in `.env`** — never in the repo, never in the client
  bundle. Secret scanning and push protection are enabled on this repository.

## Especially interested in

Anything that crosses a tenant boundary (one workspace reading another's data),
anything that makes a non-owner audience receive owner-grade persona content,
prompt-injection through uploaded documents or imported transcripts that reaches
a tool call, and any path where a published persona leaks material its owner
never marked shareable.
