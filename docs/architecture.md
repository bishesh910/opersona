# Architecture

Two services, one database, one design rule: **the browser never talks to the engine.**

```
browser ── https ──> apps/web (Next.js 15)
                        │  authenticated proxy (/api/engine/*): session + org + ownership
                        │  checks, then forwards with an internal bearer token
                        ▼
                     apps/engine (Hono + Claude Agent SDK)
                        │  live sessions, persona MCP tools, learning jobs, sandbox
                        ▼
                     Postgres 16 (Drizzle) ── the persona lives here; everything on disk
                                              (workspaces, transcripts) is disposable
```

## The engine's session model

One conversation = one live `query()` from the Claude Agent SDK:

- **Streaming input.** User turns are pushed into an async iterable, so a single subprocess
  serves the whole conversation — cache-friendly, no re-spawn per message.
- **Idle reap + resume.** After ~10 minutes of silence the subprocess exits; the SDK session id
  is stored and the next message resumes the same transcript.
- **Isolation.** Each conversation gets its own working directory (the only writable path for
  its sandboxed code, and the source of its downloadable files). Host `CLAUDE_*`/`ANTHROPIC_*`
  env vars are stripped from the subprocess; each session gets an isolated HOME plus the
  workspace's own API key, nothing else.
- **Two chat modes.** `claude` = plain Claude (your persona only *learns* from it);
  `clone` = the persona answers *as you* (its replies are rateable: "That's me / Not me").
- **Claude access.** Strictly BYO key: every workspace stores its own encrypted Anthropic key
  and all its inference (chat, learning, selfie extraction, self-tests) bills to it. A monthly
  budget is enforced at the single key-resolution chokepoint.

## Prompt assembly (cache-stable)

The system prompt is assembled stable-first so Anthropic prompt caching actually hits:

1. Frozen core rules (identical for every persona)
2. The persona snapshot — brief + confirmed reasoning patterns ("How <name> thinks"), grouped
   by dimension and sorted by strength — confirmed patterns only; emerging ones are stored and
   shown in the UI but never rendered
3. Volatile context (today's date, etc.) goes in the **first user message**, never the system
   prompt.

Every result logs input/output/cache-read tokens and cost per conversation into `session_costs`,
so cache regressions are visible in data, not vibes.

## HITL approvals

Non-sandboxed privileged tool calls route through `canUseTool` → an `approvals` row → a live SSE
event → an approval card in the UI. No answer within the timeout = denied. The sandbox exists
precisely so that *ordinary* code execution never needs this ceremony (see
[chat-and-sandbox.md](chat-and-sandbox.md)).

## Events

The engine publishes typed SSE events per conversation (the `EngineEvent` union in
`packages/shared/src/events.ts` — deltas, tool activity, produced files, approvals, results,
status; [ENGINE_API.md](ENGINE_API.md) is the contract of record) with a ring buffer
and `Last-Event-ID` replay, relayed through the web proxy so EventSource works with cookies.

## Jobs

A serial, restart-safe learning queue handles extraction on session end, episode writing, and
imports. A nightly pass tidies duplicate reasoning patterns (see [learning.md](learning.md)).
