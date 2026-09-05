# Product status

*Last updated 2026-08-28 night, after the MCP pivot (commits `9c7cf63…`). This page changes when the software changes.*

**The MCP pivot (evening):** all TALKING now lives on claude.ai through the
connector — the on-site chat (/chat, /c/*, sealed conversations, attachments,
sandboxed exec, tool approvals) and the on-site interview UI are REMOVED
(archived as the `archive/on-site-chat` tag). opersona.me is the dashboard: model
review, blind tests, corrections, simulate, share. The engine dropped its
whole session layer; the bridge now carries only inference jobs + coding-
session ingest. Privacy story got stronger: no conversations are stored at
all.

**Earlier that day:** the interview became a CHAT (your persona
messages you) and moved its recommended home into claude.ai — say
**"opersona me"** with the connector attached and your own fast Claude
conducts it (`opersona_me` / `submit_interview_answer` tools; extraction stays
async on the bridge). The in-app interview chat polls like a messenger with
background replies, cross-thread memory, session pacing, and an internal
scroll box. Bridge `opersona@0.4.0` ships warm job sessions (no more
cold-booting Claude per reply). The landing and all logged-out public pages
wear the auth pages' Night Shift look, with the pixie crowd dimmed to a
skyline. The `/explore` gallery is members-only now (individual `/p/<slug>`
pages stay public — those links are handed out by their authors). Self-serve
factory reset script for clean-slate testing. Bridge `0.4.1` makes
`npx opersona@latest install --token obr_…` the WHOLE setup — it pairs,
installs the background service from a real npm installation in
`~/.opersona-bridge/app` (0.4.0 copied a lone bundle whose `ws`/Agent-SDK
imports could never resolve, so the service crash-looped), starts it, and
reports whether it actually connected.

## Project status: v1 complete, in maintenance (2026-09-04)

The main goal — a persona that learns how a specific person thinks, proves
it blind, and runs on that person's own Claude — is met and live. Work from
here is bugs, security, and small honesty fixes. The two things the author
wanted most and could not have are recorded in the README's *Future plans*:
everything inside the app (needs server-side inference, i.e. paid API
usage the project cannot afford), and a cloned voice (Claude's own voice
cannot be replaced by a connector).

## Where we are

The full central loop — **interview → model → predict → test → correct →
predict better** — is implemented, deployed at opersona.me, and verified
end-to-end against a live test persona. Measured against the OPersona spec's
phase plan:

| Spec phase | Status |
| --- | --- |
| **1 — foundations** (auth, persona creation, dashboard, chat, Claude integration, DB, extraction) | ✅ shipped (predates this cycle) + repaired: migration system squash-baselined, 2FA enrollment fixed, security audit findings closed, real landing page, error surfaces |
| **2 — adaptive interview, memory system, behaviour patterns, evidence, retrieval** | ✅ shipped. 10 categories × 5 facets, deterministic picker, conversational interview on claude.ai ("opersona me"), contradiction probes, memories/traits/rules with epistemic tiers + verbatim-quote evidence, wired into the persona prompt and `recall_memory` (Postgres FTS; embedding seam ready, vendor-free) |
| **3 — scenario testing, human-vs-AI prediction, accuracy metrics, correction loop** | ✅ shipped. Blind-at-creation predictions (enforced in the schema and every code path, not the UI), LLM judge across 4 dimensions + code-computed calibration, similarity metric gated below 5 samples, structured correction loop that writes back into the model |
| **4 — versioning, voice, export/import, advanced privacy** | ◐ partial. Versioning (numbered snapshots + layer deltas) ✅ · full export `persona-full@2` ✅ · self-serve persona & account deletion ✅ · publish/import ✅ · **voice interview: not built** (the interview UI is transport-agnostic by design) |

## What is verified, not just written

- 163 automated tests across the workspace, including tenant isolation
  (cross-org → 404), blind enforcement (open payloads structurally lack the
  prediction; double-answer → 409; `predicted_at < answered_at`), extraction
  anti-hallucination (fabricated quotes dropped, unquoted claims demoted or
  discarded, tiers never auto-promote), simulation contract (invented evidence
  citations filtered, forced abstention), and deletion (information_schema
  sweep proves zero remaining rows). DB-writing suites run only against a
  `*_scratch`/`*_test` database.
- A live prod walkthrough on a test persona: interview answers produced
  correctly-tiered knowledge; a planted contradiction was detected, probed
  with the spec's exact question shape, and resolved into two complementary
  IF/AND/THEN rules; a blind scenario was predicted, judged (an honest 0.42
  miss), corrected, and the very next simulation led with the corrected rule.
- Playwright smoke (public surfaces, auth gates, redirects, 404) passes
  against the live site.
- **The interview is ten questions, then Ready** (2026-09-04): one designated
  opener per life area (any other opener in the area stands in if it was
  skipped); once every area has one real answer the server serves nothing more
  unless `deepen` is asked for. The build meter is re-based so one sitting can
  reach 100 (connector 20 · first answer 10 · core 40 · patterns 10 · blind
  tests 15 · depth 5). End-to-end DB test walks a fresh clone through all ten.
- **The interview never digs twice** (thread rules, 2026-09-03): a follow-up is
  linked to the answer it grew from, only the strongest one per answer is kept,
  it is held back for two turns, served once (its siblings retire), and an
  answer to a follow-up or probe never spawns another. A rephrase of a question
  asked in the last six turns is dropped by a distinctive-word overlap check;
  follow-ups older than twelve turns are retired. Pure-picker tests plus one
  end-to-end DB test pin all of it.

## Honesty guarantees baked in

- No fake numbers: every metric renders **"Not enough data yet"** below its
  sample floor; the similarity score is labelled an internal model metric.
- No mind-reading claims: outputs are behavioural predictions from evidence;
  the simulation abstains when evidence is thin; hypothesis-tier knowledge is
  never rendered into any prompt.
- No silent learning: every model change lands in `learning_events`; every
  knowledge item carries verbatim-quote evidence with click-through to its
  source answer; the owner can veto anything ("That's me / Not me").

## Known gaps / next candidates

1. **Voice interview** — mic → STT → interview engine → TTS. The interview is
   already a message exchange, so voice is a transport swap, not a redesign.
2. **Semantic retrieval** — FTS-first by design; `knowledge_embeddings` +
   the provider seam exist, pgvector is already installed on prod. Wire a
   vendor when FTS recall demonstrably fails.
3. **Shareable interview knowledge** — traits/memories/rules carry a
   `shareable` flag (default off) but the publish flow doesn't surface
   toggles for them yet; published personas currently exclude them entirely.
4. **Bridge rail per-call floor** — even with warm job sessions (the CLI boot
   is gone), the subscription rail costs ~5-9s per inference call vs ~2s on a
   direct API key. Since the pivot this touches only work where latency is
   mostly invisible (async extraction, judging) — the dashboard's simulate and
   scenario generation still feel it; an API key removes it.
5. **Fold self-tests into scenarios** — two coexisting gauges ("sounds like
   me" and "behavioural similarity") is deliberate for now; revisit after ~50
   scored scenarios of real usage.
6. **Horizontal scale** — rate limits are per-process, documented and fine
   for the single-box deploy; revisit before any second web process.

## Operational notes

- Production runs from the repo working tree (systemd `opersona-web` +
  `opersona-engine`); deploy = build + restart. `NEXT_DIST_DIR=.next-build`
  keeps verification builds off the serving `.next`.
- Migrations: `pnpm db:generate` → `pnpm db:migrate`. Databases created before
  the 2026-08 squash need `pnpm db:baseline` once (see `packages/db`).
