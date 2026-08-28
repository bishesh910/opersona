# Product status

*Last updated 2026-08-28 (commits `9c7cf63…d3524e3`). This page changes when the software changes.*

## Where we are

The full central loop — **interview → model → predict → test → correct →
predict better** — is implemented, deployed at opersona.me, and verified
end-to-end against a live test persona. Measured against the OPersona spec's
phase plan:

| Spec phase | Status |
| --- | --- |
| **1 — foundations** (auth, persona creation, dashboard, chat, Claude integration, DB, extraction) | ✅ shipped (predates this cycle) + repaired: migration system squash-baselined, 2FA enrollment fixed, security audit findings closed, real landing page, error surfaces |
| **2 — adaptive interview, memory system, behaviour patterns, evidence, retrieval** | ✅ shipped. 10 categories × 5 facets, deterministic picker, triage follow-ups, contradiction probes, memories/traits/rules with epistemic tiers + verbatim-quote evidence, wired into the persona prompt and `recall_memory` (Postgres FTS; embedding seam ready, vendor-free) |
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

1. **Voice interview** — mic → STT → interview engine → TTS. The room is a
   plain question/answer exchange, so this is additive.
2. **Semantic retrieval** — FTS-first by design; `knowledge_embeddings` +
   the provider seam exist, pgvector is already installed on prod. Wire a
   vendor when FTS recall demonstrably fails.
3. **Shareable interview knowledge** — traits/memories/rules carry a
   `shareable` flag (default off) but the publish flow doesn't surface
   toggles for them yet; published personas currently exclude them entirely.
4. **Interview triage latency** — the 6 s sync ceiling sometimes trips on the
   platform rail; the fallback is seamless (a bank question, no ack), but
   acknowledgments land less often than designed.
5. **Fold self-tests into scenarios** — two coexisting gauges ("sounds like
   me" and "behavioural similarity") is deliberate for now; revisit after ~50
   scored scenarios of real usage.
6. **Horizontal scale** — rate limits and the SSE ring buffer are
   per-process, documented and fine for the single-box deploy; revisit before
   any second web process.

## Operational notes

- Production runs from the repo working tree (systemd `opersona-web` +
  `opersona-engine`); deploy = build + restart. `NEXT_DIST_DIR=.next-build`
  keeps verification builds off the serving `.next`.
- Migrations: `pnpm db:generate` → `pnpm db:migrate`. Databases created before
  the 2026-08 squash need `pnpm db:baseline` once (see `packages/db`).
