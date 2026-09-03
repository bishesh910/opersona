# Contributing

opersona models how a specific person thinks, from their own words. That makes
two things unusual about contributing here, and they shape everything below:

1. **Honesty beats features.** The product would rather say "not enough data
   yet" than show a number it can't defend. A change that makes opersona look
   smarter without more evidence behind it will be turned down, however clever.
2. **It's someone's inner life.** Never paste real persona data, interview
   answers, tokens or keys into an issue, a PR, or a test fixture.

## Running it locally

Node 22, pnpm 9, Postgres 16.

```bash
cp .env.example .env      # set DATABASE_URL, ENGINE_INTERNAL_TOKEN, BETTER_AUTH_*, SECRETS_KEK
pnpm install
pnpm db:migrate
pnpm dev                  # web :3000, engine :4000
```

You do **not** need an Anthropic key to work on most of it: the LLM seam is
mocked in tests, and the UI runs without a rail (it just says so honestly).
See [docs/self-hosting.md](docs/self-hosting.md) for the full setup.

## Before you open a PR

```bash
pnpm typecheck
pnpm test
```

DB-writing suites only run against a database whose name ends in `_test` or
`_scratch` — a guard so nobody's real data is touched by a test run:

```bash
createdb opersona_test
DATABASE_URL=postgres://…/opersona_test pnpm test
```

CI runs exactly this on every PR.

## What gets merged quickly

- A bug fix with a test that fails before it and passes after.
- Docs that correct something wrong or unclear — including in this file.
- Accessibility and mobile fixes. The UI is used on phones more than laptops.
- Anything that makes a claim *more* traceable to evidence.

## What needs discussion first

Open an issue before writing code if your change:

- makes the persona assert something about a person that the evidence doesn't
  support, or renders unconfirmed material into a prompt;
- weakens a boundary — tenant isolation, the shareable-by-default-off rule, the
  blind-prediction seal, or what leaves in a published persona;
- sends conversation content to the server. Conversations live on claude.ai and
  the user's own machine; only distilled memory reaches the database, and that
  is deliberate;
- adds a paid dependency or a hosted service the self-hosted path can't run.

## The shape of the code

| Where | What lives there |
| --- | --- |
| `apps/web` | Next.js: dashboard, auth, the claude.ai MCP connector, the engine proxy |
| `apps/engine` | Hono: interview picker + extraction, blind predictions, corrections, simulation |
| `packages/db` | Drizzle schema and migrations — the provenance spine lives here |
| `packages/shared` | zod schemas, crypto, redaction, the interview constants |
| `packages/bridge` | the `npx opersona` daemon that runs inference on the user's own Claude |
| `docs/` | how it works and why — [architecture](docs/architecture.md), [user-flow](docs/user-flow.md), [ENGINE_API](docs/ENGINE_API.md) |

## Commits and reviews

Small commits with a message that says *why*, not just *what*. Squash-merged, so
the PR title becomes the history — write it for someone reading `git log` in a
year. Expect questions; they're about the code, not about you.

## Licence

By contributing you agree your work ships under [AGPL-3.0-or-later](LICENSE),
the same licence as the rest of the project.
