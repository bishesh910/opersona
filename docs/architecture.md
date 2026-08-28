# Architecture

Two services, one database, one design rule: **the browser never talks to the engine.**
And one product rule that shapes everything since the MCP pivot: **the site doesn't talk.**
All conversation — persona chat and the cognitive interview — happens on claude.ai through
the opersona connector; opersona.me is the dashboard (model review, blind tests, corrections,
simulate, share), and the engine is the deterministic core plus async learning.

```
claude.ai ── MCP (OAuth) ──> apps/web /mcp  (my_persona, use_persona, recall_memory,
                              save_insight, learn_from_this_chat, opersona_me,
                              submit_interview_answer, search_community, list_my_roster)
browser ──── https ────────> apps/web (Next.js 15)
                                │  authenticated proxy (/api/engine/*): session + org +
                                │  ownership checks, then an internal bearer token
                                ▼
                             apps/engine (Hono)
                                │  interview picker + extraction, blind predictions,
                                │  corrections, simulation, imports, learning queue
                                ▼
                             Postgres 16 (Drizzle) ── the persona lives here; no
                                                      conversations are stored at all
user's machine ── WS ──────> engine /bridge/ws  (jobs: inference on their subscription ·
                              ingest: finished Claude Code / Codex sessions to learn from)
```

## Where inference runs

Strictly the user's own Claude — there is no platform key:

- **Bridge jobs.** The engine sends structured/text inference jobs (interview extraction,
  brief drafting, judging, simulation) over the bridge socket to the user's machine, where
  they run on the Claude subscription they already pay for. Warm job sessions (bridge ≥0.4)
  keep a Claude process alive per job shape, so repeated extractions skip the CLI boot.
- **Org API key.** A workspace may store its own encrypted Anthropic key instead; all its
  inference bills to it. A monthly budget is enforced at the single key-resolution chokepoint.
- **claude.ai.** The conversation itself — chat and interview — costs the platform nothing:
  the user's own claude.ai Claude does the talking and reaches opersona only through
  connector tool calls.

## Prompt assembly (cache-stable)

The system prompt (served to the connector via `my_persona`/`use_persona`, and used by
simulation) is assembled stable-first so Anthropic prompt caching actually hits:

1. Frozen core rules (identical for every persona)
2. The persona snapshot — brief + confirmed reasoning patterns ("How <name> thinks"),
   personality lens, interview-learned traits / rules / memories (tiered; hypothesis never
   rendered), grouped and sorted deterministically — confirmed material only
3. Volatile context (today's date, etc.) belongs in the first user message, never the
   system prompt.

Every engine inference logs input/output/cache-read tokens and cost into `session_costs`,
so cache regressions are visible in data, not vibes.

## Jobs

A serial, restart-safe learning queue handles interview extraction, episode writing, and
imports. Bridge watcher ingest (finished Claude Code / Codex coding sessions) and connector
`learn_from_this_chat` transcripts feed the same extractors. A nightly pass tidies duplicate
reasoning patterns (see [learning.md](learning.md)).
