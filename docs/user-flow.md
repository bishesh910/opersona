# The user flow

One loop, and every surface exists to serve it:

```
INTERVIEW ──> MODEL ──> PREDICT ──> TEST ──> CORRECT ──> PREDICT BETTER
    ▲                                             │
    └─────────────────────────────────────────────┘
```

The success metric is not "the chat sounds nice" — it is *does the system get
better at predicting the person over time?* Everything below feeds that.

## 1 · Arrive — `/`

Logged-out visitors get the landing: what it is (interview / receipts / blind
tests), the loop, and two doors — **Build my persona** (`/sign-up`) and
**See how it works** (`/about`). `/about`, `/privacy` and `/p/<slug>` (a link a
persona's author hands out deliberately) are public; the `/explore` gallery is
members-only — no anonymous browsing of the community.

## 2 · Create an account — `/sign-up` → `/pending` → in

Email + password (social when configured). Invite-only by default;
`ALLOW_SIGNUP=true` opens it with **admission control** — new accounts wait at
`/pending` until a platform admin approves them at `/admin/approvals`.
Optional-to-mandatory TOTP 2FA (`/setup-2fa`).

## 3 · Onboarding — `/onboarding` (Connect → Pixie → Story → Mind → Ready)

Five short steps, no AI settings to configure:

| Step | What happens |
| --- | --- |
| **Connect** | Pick a rail: the bridge (your own Claude subscription — one command, `npx opersona@latest install --token obr_…`, pairs it AND runs it terminal-free at every login) or an API key. Skippable. |
| **Pixie** | An avatar — from a selfie (never stored), a dice roll, or by hand. |
| **Story** | Four one-line questions → an AI-drafted first-person brief you edit. |
| **Mind** | A 12-question personality quick take (or the full 24). Flavour, never authority. |
| **Ready** | The persona exists. The next step it teaches: say **"opersona me"** on claude.ai. |

## 4 · The cognitive interview — on claude.ai, by saying "opersona me"

The core teaching surface is a CONVERSATION, and it happens where conversations
are best: on claude.ai, with the opersona connector attached. Say
**"opersona me"** and your own Claude becomes the interviewer (via the
`interview_me` / `submit_interview_answer` tools): it asks about real moments
("Tell me about the last time…", never "are you a risk taker?"), follows the
threads your answers open, keeps your verbatim words, and lands each completed
exchange in opersona. Replies are instant — the conversation runs on the Claude
you already use. **The core interview is ten questions** — one per area of life,
about fifteen minutes, numbered so you can see the end — and finishing it makes
the persona Ready. Nothing more is required. Going deeper is on request only:
three questions at a time, follow-ups and contradiction probes included, and it
resumes exactly where you left off.

The site itself has NO interview UI (and no chat): opersona.me is the dashboard
where you review what the interview learned.

Behind each submitted exchange:

- an instant next question from a deterministic picker (coverage gap ×
  uncertainty × info gain; a ~50-question authored bank means zero cold-start),
- an async extraction — on your bridge or key, where slowness costs nothing —
  into **memories** (what happened), **traits**
  (values / beliefs / preferences / behaviours / decision patterns) and
  **contextual rules** (IF situation AND condition THEN tendency) — every item
  tiered *you said this / observed / hunch* with verbatim quotes, and
- every 5th completed answer, the batch is ALSO mined for **reasoning
  patterns** ("How I think") — the answers are real writing where reasoning
  style is visible, held to the same verbatim-quote discipline, and
- **contradiction hunting**: when an answer sits oddly against the model
  ("independence matters" vs "accepted financial dependence"), an open tension
  is recorded and its probe question — *"what makes those situations
  different?"* — jumps the queue. A good resolution becomes a rule.

Progress is per-category meaning ("What matters to you ▓▓▓░ 62%", "just
getting started"), never "37/1000 questions".

## 5 · Review the model — `/me` and `/me/memory`

The dashboard (`/me`) shows honest numbers: patterns, interview answers,
sounds-like-me, behavioural similarity — every metric renders **"Not enough
data yet"** until it is real. `/me/memory` is the transparency surface: traits,
memories and rules with tier chips, confidence bars, and the verbatim evidence
quotes behind every item. **That's me / Not me** on every
item; edits to old answers keep the old wording as a revision and withdraw
anything that only stood on it.

## 6 · Use it — the connector and `/me/simulate`

- **Talk as/with your persona on claude.ai — or in Claude Code**
  (`claude mcp add --transport http opersona https://opersona.me/mcp`, then `/mcp` to sign in): `my_persona` loads your own
  persona into the conversation; teammates and adopters load yours with
  `use_persona` (shareable material only); `recall_memory` serves its memory
  mid-chat; `learn_from_this_chat` turns any conversation into lessons — your own
  Claude distills the reasoning moves in place and sends only the distillate
  (short verbatim quotes included); the transcript never leaves claude.ai.
- **Simulate** (`/me/simulate`): one structured behavioural prediction —
  *What would I do? · How would I reply? · What would I choose? · A or B? ·
  What factors would weigh?* — with your ranked factors, honest confidence,
  explicit uncertainty and the evidence it stood on. It abstains
  ("I don't have enough information") rather than guessing.

## 7 · Test it blind — `/me/survey` ("Test me")

The honesty loop. Generate scenarios aimed at the model's *weak* spots; each
one is answered by your twin **before you see it** — the prediction is sealed
at creation (`predicted_at < answered_at` is stored and shown: "prediction
locked in 2 h before you answered"). You answer, then the reveal: side-by-side
answers and per-dimension scores (decision / reasoning / preference /
communication / calibration). Under 5 scored scenarios the similarity metric
says "Not enough data yet"; ever after it is labelled an internal model
metric, not science. The older "does it sound like me?" self-tests live on the
same page as a second, separate gauge.

## 8 · Correct it — the part that matters most

When the twin misses: **"What did I get wrong?"** — wrong decision / wrong
reason / missing context / exception / outdated belief / misread preference —
plus your own words. One pass turns that into counter-observations and
candidate knowledge (usually a rule: *"when the risk touches people I love, I
build the cushion first"*), the fingerprint recomputes, the prompt republishes
as a new version, and the next prediction is better. Misses teach it the most.

## 9 · Share, export, leave — on your terms

- **Publish** (`/me/share`): a privacy-safe artifact, section by section, with
  a full preview of exactly what leaves. Public or grant-restricted;
  unpublish any time. Others adopt it at `/p/<slug>` or via `use_persona`.
- **Export**: the full private model as JSON (`persona-full@2`: brief,
  fingerprint, facts, playbooks, memories, traits, rules, interview answers,
  prediction tests, corrections, prompt) or an Obsidian-ready vault.
- **Delete** (Settings → Account): persona or whole account, self-serve,
  permanent — every table that references it plus the files on disk.

## Where each spec concept lives

| Concept | Surface |
| --- | --- |
| Adaptive interview, follow-ups, contradictions | claude.ai — say "opersona me" (connector) |
| Memories vs behaviour patterns, evidence, tiers | `/me/memory` |
| Explicit / inferred / hypothesis | tier chips everywhere; hypothesis never enters a prompt |
| Contextual rules & exceptions | `/me/memory` → "Rules & exceptions"; consulted by the connector + simulate |
| Blind prediction tests, accuracy dimensions | `/me/survey` |
| Correction loop | scenario reveal → "It got me wrong" |
| Simulation modes | `/me/simulate` · persona chat via the connector |
| Versioning | `/me/memory` → "Version history" (numbered snapshots, layer deltas) |
| Export / deletion | Patterns header buttons · Settings → Account |
