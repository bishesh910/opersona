# Engine HTTP API (apps/engine, Hono, default port 4000)

The engine is **internal**: the browser never calls it directly. Next.js route handlers in
`apps/web` authenticate the user/org, enforce per-resource ownership, then proxy to the engine
with `Authorization: Bearer $ENGINE_INTERNAL_TOKEN`. The engine trusts the *identity*
(`orgId`/`userId`) the token-holding web layer passes, but independently re-validates resource
ownership and input shapes on its side.

All JSON unless noted. Errors: `{ error: string }` with 4xx/5xx.

## Where chat went

There are no conversation endpoints. All TALKING — the persona chat and the
cognitive interview — happens on **claude.ai through the opersona connector**
(MCP tools served by apps/web: `my_persona`, `use_persona`, `recall_memory`,
`save_insight`, `learn_from_this_chat`, `opersona_me`,
`submit_interview_answer`, `search_community`, `list_my_roster`). The engine
keeps the deterministic core (interview picker, extraction, predictions,
simulation) and runs inference through org keys or bridge jobs.

## Avatar

### `POST /avatar/from-selfie`
`{ orgId, imageBase64, mime }` → Claude vision → `{ recipe, confidence }`. The image is
**never persisted**.

### `POST /avatar/render`
`{ recipe, scale? (1–16), kind?: 'portrait'|'sheet' }` → `image/png`. Pure render, no model
call (the live editor renders client-side; this is for cached PNGs).

## Persona

- `POST /clones/:id/snapshot` `{ orgId }` → re-renders the persona snapshot →
  `{ snapshotId, version, promptHash, tokenEstimate }`.
- `GET /clones/:id/prompt?orgId=…` → `{ prompt }` — the assembled system prompt (owner-only).
- `GET /clones/:id/export?orgId=…` → full persona JSON export (owner-only).
- `GET /clones/:id/export-vault?orgId=…` → episodic-memory vault as a Markdown zip (owner-only).
- `GET /clones/:id/accuracy?orgId=…` → `{ me, notMe, pct }` self-test + feedback accuracy.

## Learning

- `POST /clones/:id/fingerprint/recompute` `{ orgId }` → recompute + republish.
- `POST /clones/:id/fingerprint/tidy` `{ orgId }` → merge duplicate pattern keys (verify-gated).
- `POST /clones/:id/patterns/:key` `{ orgId, userId, verdict: 'accept'|'reject'|null }` —
  human verdict on a pattern (accept = confirmed regardless of count; reject = never rendered).
- `POST /clones/:id/self-test` `{ orgId }` → generate a 3-problem "does it sound like me?"
  batch answered by the persona.
- `POST /clones/:id/self-test/:testId/rate` `{ orgId, verdict: 'me'|'not_me', comment? }`.
- `POST /clones/:id/episodes/backfill` `{ orgId, userId, cloneId }` → write episodes for
  finished conversations from the chat era that don't have one yet.
- `POST /imports/:id/start` `{ orgId }` → 202. Web saves the export file (claude.ai zip,
  ChatGPT/Codex export) under the org's uploads and inserts an `import_jobs` row first;
  progress lives in that row.
- Claude Code: `POST /clones/:id/claude-code/{tokens,upload}`,
  `POST /clones/:id/claude-code/tokens/:tokenId/revoke`,
  `GET /clones/:id/claude-code/sessions` (owner-only).

## Documents

### `POST /documents/:id/ingest`
`{ orgId }` → reads the uploaded file from the org's uploads dir, extracts text (txt/md/pdf),
chunks, writes `document_chunks`. `{ chunks: n }`.

## Misc

- `GET /health` → `{ ok, version, learningQueue }`.
- `GET /bridge/status?orgId=` → `{ connected, host?, since? }` — is an opersona bridge online for this workspace.
- `WS /bridge/ws` (public path, proxied by Caddy; `Authorization: Bearer obr_…`) — the opersona
  bridge socket. Two frame families matter now: **jobs** (the engine sends structured/text
  inference jobs — extraction, drafting, simulation — to run on the user's subscription, with
  warm session reuse) and **ingest** (the watcher streams finished Claude Code / Codex sessions
  up for learning). Chat-session frames from older bridges are parsed and ignored.
- `POST /keys/validate` `{ apiKey }` → `{ ok, model }` or `{ ok: false, status, error }`
  (always HTTP 200). Called before storing an org key — a bad key otherwise looks like a hang
  (the SDK retries 401s ~11× with backoff; `status` SSE events surface those retries).

## Cognitive interview + knowledge model

All owner-only through the web proxy (`access.canWrite`); the engine re-checks the clone↔org pair.

- `POST /clones/:id/interview/next` `{ orgId, userId }` → `{ question, progress }` — the current
  (resume-safe) or next question. The picker is deterministic: coverage gap × uncertainty ×
  info gain + follow-up/contradiction bonuses − rotation/skip penalties; the ~50-question
  authored bank needs no LLM, so this always answers fast.
- `POST /clones/:id/interview/submit-thread` `{ orgId, questionId, userText, dialogue? }` — the
  MCP path: the interview CONVERSATION runs inside claude.ai (the user's own fast Claude plays
  the interviewer via the `opersona_me` / `submit_interview_answer` connector tools); a
  completed exchange lands here as one answer (user's verbatim words quotable, dialogue as
  context) and rides the same extraction pipeline. Returns the next question. This is the
  recommended free-tier interview: conversation latency lives where a warm Claude already runs;
  only the async extraction touches the bridge, where slowness costs nobody anything.
- `POST /clones/:id/knowledge/{trait|memory|rule}/:itemId/verdict` `{ orgId, userId, verdict:
  'confirm'|'dispute'|null }` — owner verdict ("that's me" / "not me" / reset); logged to
  `learning_events`, snapshot republished.

Epistemic tiers are code-enforced, not prompt-hoped: quotes must appear verbatim in the answer,
a trait with no verified quote survives only as `hypothesis` (confidence ≤ 0.6), memories/rules
without receipts are dropped, tiers never auto-promote (only new explicit quoted evidence or an
owner verdict, always via `learning_events`). Hypothesis-tier is never rendered into any prompt;
non-owner audiences see only rows marked `shareable` (default false).

## Blind prediction tests + simulation

- `POST /clones/:id/scenarios` `{ orgId, userId, count? }` — generate a batch; each scenario's
  blind prediction is made and SEALED at creation (`predicted_at < answered_at` is a stored
  invariant). Generation targets the model's weak spots (hypothesis/low-confidence traits, open
  tensions, uncovered reasoning dimensions, low-scoring recent categories).
- `GET /clones/:id/scenarios?view=open|history` — `open` serves OPEN_COLUMNS only: the
  prediction and scores are structurally absent from blind payloads.
- `POST /clones/:id/scenarios/:sid/answer` `{ orgId, userId, answer, factors? }` — one atomic
  `UPDATE … WHERE status='open'` (409 on a double submit), then the LLM judge scores decision /
  reasoning / preference / communication (calibration is computed in code:
  `1 − |confidence − decision_match|`). A judge crash leaves `failed` with the answer intact.
- `POST /clones/:id/scenarios/:sid/skip` · `POST …/:sid/correct` `{ kinds[], note }` — the
  correction loop: counter-observations + candidate knowledge proposals (trait/rule/memory/fact)
  with the person's words as evidence, then fingerprint recompute + snapshot republish.
- `GET /clones/:id/similarity` — per-dimension averages + overall (null under 5 scored:
  "Not enough data yet"); labelled an internal model metric.
- `POST /clones/:id/simulate` `{ orgId, userId, mode: ask|respond|decide|compare|explain, text,
  options?, context? }` — one-shot behavioural prediction. Context is assembled server-side
  (recall + documents BEFORE the call); the output contract is code-enforced: `evidence_used`
  is filtered to the ids the server actually retrieved, thin evidence forces the standard
  "I don't have enough information" abstention, compare requires per-option verdicts. Never
  writes to `conversations`.

## Deletion (server-to-server)

- `POST /orgs/purge-files` `{ orgId }` — remove the whole org data dir (account deletion).
- `POST /clones/:id/purge-files` `{ orgId, documentIds? }` — remove one clone's dirs + its
  upload files (persona deletion). DB truth never depends on these; they are best-effort
  filesystem cleanup after the information_schema-driven row sweep in the web tier.
