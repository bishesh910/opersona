# Engine HTTP API (apps/engine, Hono, default port 4000)

The engine is **internal**: the browser never calls it directly. Next.js route handlers in
`apps/web` authenticate the user/org, then proxy to the engine with
`Authorization: Bearer $ENGINE_INTERNAL_TOKEN`. The engine trusts the `orgId`/`userId` the
web layer passes because only the web layer holds the token.

All JSON. Errors: `{ error: string }` with 4xx/5xx.

## Conversations / chat

### `POST /conversations/:conversationId/messages`
Body: `{ orgId, userId, cloneId, text }`
Starts (or continues via SDK `resume`) the clone session and enqueues the user turn.
Returns `202 { ok: true }`. The reply streams on the events endpoint.

### `GET /conversations/:conversationId/events?orgId=…`
Server-Sent Events. Each event is `data: <EngineEvent JSON>` (type from `@opersona/shared`):
`session | text_delta | assistant_message | tool_use | tool_result | approval_request | approval_resolved | result | error`.
Supports `Last-Event-ID` replay from a ring buffer (last 500 events per conversation).
Send `: ping` comments every 15s.

### `POST /conversations/:conversationId/end`
Body: `{ orgId }` → closes the live session (marks idle, enqueues extraction in Phase 1). `{ ok: true }`.

## Approvals (HITL)

### `POST /approvals/:approvalId`
Body: `{ orgId, userId, behavior: 'allow' | 'deny', updatedInput?, answer?, message? }`
Resolves a pending `canUseTool` / `ask_human` wait. `{ ok: true }`; `404` if unknown/expired.

## Avatar

### `POST /avatar/from-selfie`
Body: `{ orgId, imageBase64, mime: 'image/jpeg' | 'image/png' | 'image/webp' }`
Runs Claude vision → `AvatarRecipe`. The image is **not persisted**. Returns `{ recipe, confidence: Record<string, number> }`.

### `POST /avatar/render`
Body: `{ recipe: AvatarRecipe, scale?: number (1–16, default 8), kind?: 'portrait' | 'sheet' }`
Returns `image/png`. Pure render, no model call. (The web app also renders client-side on a canvas for the live editor; this endpoint is for cached PNGs / `<img>` tags.)

## Persona

### `POST /clones/:cloneId/snapshot`
Body: `{ orgId }` → renders a new `persona_snapshots` row from the current layers and sets
`clones.active_snapshot_id`. Returns `{ snapshotId, version, promptHash, tokenEstimate }`.
Phase 0: call after brief/facts/playbooks are edited (web does this automatically).

### `GET /clones/:cloneId/prompt?orgId=…`
Returns `{ prompt }` — the assembled system prompt, for the "what my clone knows" debug view.

## Documents

### `POST /documents/:documentId/ingest`
Body: `{ orgId }` → reads the uploaded file from `ENGINE_DATA_DIR/orgs/<org>/uploads/<documentId>`,
extracts text (txt/md/pdf), chunks (~1200 chars), writes `document_chunks`. `{ chunks: n }`.
The web layer saves the upload to that path before calling.

## Health
`GET /health` → `{ ok: true, version }`

## Keys
### `POST /keys/validate`
Body: `{ apiKey }` → `{ ok: true, model }` or `{ ok: false, status, error }` (always HTTP 200). The web
app calls this before storing an org key; a bad key otherwise surfaces as a multi-minute retry loop
inside the SDK subprocess (it retries 401s 11× with backoff). Chat streams now also emit
`{ type: 'status', message, attempt, max }` events during those retries.

## Learning (reasoning fingerprint)
- `POST /conversations/:id/extract` `{ orgId, cloneId }` → 202. Ends the live session (if any) and re-runs the reasoning extractor on the conversation. Automatic on session end / idle; this is the manual "learn from this chat now" button.
- `POST /clones/:id/fingerprint/recompute` `{ orgId }` → `{ patterns }` recompute + republish snapshot.
- `POST /clones/:id/patterns/:key` `{ orgId, userId, verdict: 'accept' | 'reject' | null }` → human verdict on a pattern (accept = confirmed regardless of count; reject = never rendered). Recomputes + republishes.
- `POST /conversations/:id/feedback` `{ orgId, userId, cloneId, turnId, verdict: 'me' | 'not_me', comment? }` → `{ ok, observations }`. "That's me / not me" on an assistant turn. With a comment it also produces observations.
- `POST /imports/:id/start` `{ orgId }` → 202. Web inserts `import_jobs` row, saves the claude.ai export (.zip or conversations.json) to `ENGINE_DATA_DIR/orgs/<org>/uploads/import-<importId>`, then calls this. Progress is in `import_jobs` (total/processed/skipped/observations/status).
- `assistant_message` SSE events now carry `turn_id` (for feedback).
- Tables for display (read directly): `reasoning_patterns` (status emerging|confirmed|rejected, strength, n_sources, examples, user_verdict), `reasoning_observations`, `reasoning_feedback`, `import_jobs`.

## Chat parity (1a)
- `POST /conversations/:id/messages` now accepts `attachments?: [{ name, mime, dataBase64 }]` (≤8, ≤10 MB each). Images (jpeg/png/gif/webp) go to the model as image blocks; text files are inlined as `<attachment name=…>`; PDFs are text-extracted. `text` may be empty if there are attachments.
- `POST /conversations/:id/settings` `{ orgId, model?: string|null, effort?: 'low'|'medium'|'high'|'xhigh'|'max'|null }` — per-conversation override (null = org default). Ends the live session; the next message resumes the transcript under the new settings.
- `conversations.mode` = `claude` (plain Claude, persona only learns) | `clone` (answers as the clone). `conversations.model/effort` nullable overrides.
