# Learning: the reasoning fingerprint

The founding idea: **learn how the person thinks, not what they said.** Two people can both
compute 2+2 — one decomposes it as 1+1+1+1, the other reframes it as 4−2+4−2. The *method* is
the identity. opersona models the method.

## What gets learned

**Reasoning observations** — domain-free descriptions of thinking moves, extracted from the
person's own turns only (never from tool output, never from documents):

- a stable `pattern_key` (the extractor reuses keys across sessions so evidence accumulates)
- a dimension (approach, verification, communication, …)
- a one-sentence description in present tense
- **verbatim evidence quotes** from the person's messages

Observations aggregate into **patterns** with decayed strength. A pattern is only *confirmed* —
and only then rendered into the persona's prompt — when it has evidence from ≥3 independent
conversations *with sufficient recent (decayed) strength*, when the person explicitly accepts
it, or when it comes from the person's own typed feedback (a correction is a human verdict and
never waits for repetition). Rejected patterns never come back (negatives
are fed to the extractor). **Silence beats a wrong stereotype.**

## What deliberately does NOT teach it

- Compliments and small talk (no reasoning moves → the extractor emits nothing)
- Content pasted into chat (that lands in episodic memory, not the fingerprint)
- Anything in `clone`-mode test chats *except* your explicit "That's me / Not me" ratings

## Sources

| Source | How |
| --- | --- |
| Live chats | extraction runs automatically when a session ends |
| claude.ai | export zip upload — newest-first, resumable |
| Claude Code | local project scan or transcript upload (with growth guards so huge sessions aren't re-mined) |
| ChatGPT / Codex | export upload, same extractor |
| Self-tests | "Not me" ratings with a comment produce counter-observations |
| Chat feedback | "That's me / Not me" on any clone-mode reply |

## Episodic memory

Separate from the fingerprint: each finished conversation is distilled into an **episode**
("problem, approach, key decisions, outcome") that the persona can recall via a `recall_memory`
tool. Episodes are strictly owner-private — a visitor asking your persona gets a refusal, not
your history. The whole vault exports as interlinked Markdown (Obsidian-compatible).

## Self-tests: "does it sound like me?"

The engine generates three short problems from the person's actual fields (inferred from their
projects and their own quotes — but never a problem they already solved), answers them **as the
persona**, and asks the person to rate each answer *me / not me*. Ratings feed the accuracy
stat; a "not me" with a comment teaches the persona what you'd have done instead.

## Pattern hygiene

A nightly pass (also on demand) merges duplicate keys the extractor coined for the same habit —
behind verify gates: only existing keys, never absorbing a human-accepted pattern, evidence
re-keyed rather than lost, everything logged as a learning event.

## Honest limits

The fingerprint is a *prompt-sized distillation*, not a simulation. It gets things wrong; the
whole feedback loop (accept/reject, self-tests, "not me" comments) exists because correction is
the product, not an afterthought.
