# opersona

**How to think, not what to think.**

A webapp where every person gets a **clone**: a persistent Claude agent that learns, from the
person's own conversations, *how they think and troubleshoot* — a reasoning fingerprint, not a chat
history. Clones stand in for their humans (colleagues ask the clone when the person is away) and,
in **The Office** (the next phase), work together on a shared office floor. Built on the
**Claude Agent SDK** (TypeScript, server-side).

Design: `/home/bee/.claude/plans/i-want-to-create-atomic-liskov.md` (product plan) ·
`docs/ENGINE_API.md` (web ↔ engine contract).

## Layout

```
apps/web        Next.js 15 — auth (better-auth + orgs), clones, brief, avatar, chat, memory, documents, approvals, settings
apps/engine     Hono + Claude Agent SDK — one live query() per conversation, persona MCP tools, HITL approvals, SSE, jobs
packages/db     Drizzle schema (persona layers with provenance spine) + migrations
packages/shared redactSecrets, FIPA-lite message schema, SSE event types, AvatarRecipe, AES-GCM secrets
packages/pixel-avatar  procedural 18×28 pixel portrait engine — selfie → Recipe → PNG
scripts/        set-org-key (store an org's BYO API key)
```

## Run (pilot box)

```bash
# prerequisites already installed here: Node 22 (fnm), pnpm 9, Postgres 16 + pgvector
cp .env.example .env            # already done; fill ANTHROPIC_API_KEY only if you want a platform fallback key
pnpm install
pnpm db:migrate                 # applies packages/db/drizzle/*
pnpm dev                        # web on :3000, engine on :4000
```

Then: sign up → create org → **Settings → paste the org's Anthropic API key** (validated live) →
**Clones → Create my clone** → fill the brief → upload a selfie → chat.

```bash
pnpm set-org-key --org <organizationId> --key sk-ant-...     # CLI alternative to Settings
```

## Verify

```bash
pnpm typecheck && pnpm test                      # unit + integration (uses the local DB)
SMOKE_ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @opersona/engine test   # live smoke test (api-key mode)
```

## How it learns

Chat is plain Claude. After each conversation (and from imported claude.ai history) an extractor
pulls **domain-free reasoning moves** — "breaks a problem into familiar pieces and recombines them",
"rejects a narrative until shown the raw log lines" — each with the person's own words as evidence.
Patterns become *confirmed* after appearing in 3 separate chats (or a "That's me" click) and only then
shape the clone. "Not me" on a reply, with a sentence on what you'd have done, is the strongest signal.

## Key decisions

- **Pilot = your own Claude login; teams = API keys.** Anthropic's policy restricts consumer OAuth to
  Claude Code/claude.ai, so a multi-user deployment uses per-org API keys (`ENGINE_AUTH_MODE=api-key`).
- **Persona is data, not a transcript.** Seven layers (brief, facts, playbooks, style, episodes,
  corrections, autonomy), every learned row carrying status/confidence/source/verbatim evidence.
- **Prompt is cache-stable.** Frozen `CORE_RULES` → persona snapshot → org block; nothing
  time-varying above the line (dates go in the first user turn). `prompt_hash` + cache-read tokens
  are logged per session in `session_costs`.
- **Clones have no shell.** v1 tools are the persona MCP server (`recall_memory`, `get_playbook`,
  `propose_playbook`, `record_lesson`, `search_documents`, `ask_human`) plus read-only `Read/Glob/Grep`
  inside a disposable per-clone workspace. Anything else goes through `canUseTool` → the owner.
- **Selfie never persisted.** Vision → `AvatarRecipe` (enums + RGB) → rendered by the pixel engine.
