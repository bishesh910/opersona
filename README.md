# opersona

**How you think, not what you know.**

opersona is a self-hosted webapp where every person on a team gets a **Pixie** — a persistent
Claude persona that learns their *reasoning fingerprint* from the way they actually work: how they
break problems down, what they check first, when they push back. Not a chat-history parrot — a
model of *how* someone thinks, built from evidence, gated by their own confirmation.

Colleagues can ask your Pixie things when you're away. You can test it ("does this sound like
me?") and correct it. The TALKING happens on **claude.ai through the opersona connector** —
your own Claude interviews you, plays your persona, and recalls its memory; opersona.me is the
dashboard where the model lives, shows its receipts, and gets tested blind. The learning runs
on **your own machine**, on **your own Claude subscription** — no vendor key, and your
conversations are never stored on the opersona server at all.

![Sign in](docs/images/signin-desktop.png)

## What it does

- **Interviews you — ten questions, about fifteen minutes.** Say **"opersona me"** with the
  opersona connector attached and your own Claude asks for one real moment from each of ten
  areas of life — identity, values, decisions, relationships, work, money, feelings, ethics,
  social life, the future. That's the whole requirement: finish it and the persona is Ready.
  Going deeper is optional and on request — three questions at a time, chasing the threads
  your answers opened and probing where your story doesn't quite add up ("what makes those
  situations different for you?"). Everything it learns is tiered honestly — *you said this* /
  *observed* / *hunch* — and traceable to your own words.
- **Predicts you, blind, and keeps score.** Fresh scenarios are answered by your persona BEFORE
  you see them (the prediction is sealed at creation — it can never peek). You answer, it
  reveals, an LLM judge scores decision / reasoning / preference / communication match, and
  "what did I get wrong?" turns every miss into corrections it learns from. The similarity
  metric refuses to show a number until there's enough data.
- **Simulates you on demand.** "What would I do / say / choose?" — one structured behavioural
  prediction with your ranked factors, honest confidence, explicit uncertainty, and the evidence
  it stood on. It abstains rather than guesses.
- **Learns how you think.** Every conversation is mined (on your machine, by your Claude) for
  domain-free reasoning patterns — *"wants raw command output before hypothesizing"*, *"invites
  criticism of their own proposals"* — each backed by verbatim quotes from your own messages.
  Patterns only enter your persona once confirmed by repetition or by you. Silence beats a wrong
  stereotype.
- **Remembers what happened.** An episodic memory distills each conversation it learns from
  ("what was the problem, what did we decide") that your persona can recall later — and that you
  can export as a Markdown vault (Obsidian-compatible). Owner-private, always.
- **Imports your history.** claude.ai export zips, Claude Code sessions (hook or upload),
  and ChatGPT / Codex exports all feed the same extractor.
- **Lives inside claude.ai — and Claude Code.** The connector puts your persona where you
  already talk: `my_persona` loads it into any conversation, `recall_memory` serves its memory
  mid-chat, `save_insight` and `learn_from_this_chat` teach it, and teammates load your
  published persona with `use_persona`. In the terminal it's one command
  (`claude mcp add --transport http opersona https://opersona.me/mcp`) — and since the bridge
  already learns from your Claude Code sessions, the persona rides along in the same tool it
  learns from. No second chat app to live in.
- **Pixies.** Every person gets a procedurally drawn pixel avatar — from a selfie (never stored)
  or a dice roll — that blinks, thinks, and talks in the UI.
- **Private by construction.** Invite-only by default (`ALLOW_SIGNUP` opens it, with admin
  admission), optional-to-mandatory TOTP two-factor auth (`REQUIRE_2FA`), and the strongest
  conversation-privacy stance available: **conversations are not stored here at all** — they
  happen on claude.ai and your machine; the database holds only the distilled persona, which
  you can read, edit, and delete. No page, stream, or API shows an admin anyone's content.
  There's a Privacy page in-app that says exactly what's visible to whom.
- **Shareable, on your terms.** Publish a privacy-safe persona artifact to the community
  (public or grant-restricted), let others import it, take it down any time.

## Pixies

Flat, cute, procedural pixel people — 11 hairstyles, 6 garments, glasses, hats, facial hair,
freckles, dip-dye tips, all from one typed recipe.

![Pixie styles](docs/images/pixie-styles.png)
![Pixie clothes](docs/images/pixie-clothes.png)
![A crowd of Pixies](docs/images/pixie-crowd.png)

## Architecture

```
apps/web         Next.js 15 — auth (better-auth, invite-only + TOTP), the dashboard (model
                 review, blind tests, simulate, share, settings), and the claude.ai MCP
                 connector; talks to the engine only through an authenticated proxy
apps/engine      Hono — interview picker + extraction, blind predictions, corrections,
                 simulation, learning queue; inference via org keys or bridge jobs
packages/db      Drizzle + Postgres 16 — persona layers with a provenance spine (every learned
                 row carries evidence, confidence, and status), episodes, costs
packages/shared  zod schemas (AvatarRecipe, bridge frames), redactSecrets, crypto helpers
packages/bridge  npm `opersona` — the machine-side daemon: inference jobs on your subscription
                 + learning from finished Claude Code / Codex sessions
packages/pixel-avatar  the Pixie engine — recipe → 36×56 portrait, animation frames, PNG/canvas
```

Key design choices, documented in [`docs/`](docs/):

| Doc | What's inside |
| --- | --- |
| [user-flow.md](docs/user-flow.md) | The end-to-end journey — landing → onboarding → interview → model review → blind tests → corrections → share/export/delete |
| [product-status.md](docs/product-status.md) | Where the product stands vs the spec: shipped, verified, gaps, next |
| [architecture.md](docs/architecture.md) | The two-service layout, the connector, bridge jobs, prompt assembly, cost logging |
| [learning.md](docs/learning.md) | Reasoning fingerprint, episodes, imports, self-tests, pattern hygiene |
| [pixies.md](docs/pixies.md) | The avatar engine: recipes, the v2 art style, animation, regression contract |
| [security-and-privacy.md](docs/security-and-privacy.md) | Threat model, auth, sandbox guarantees, the privacy model |
| [self-hosting.md](docs/self-hosting.md) | What it takes to run this on your own box (honest edition) |
| [devlog.md](docs/devlog.md) | Milestones — what was built, in what order, and why |
| [ENGINE_API.md](docs/ENGINE_API.md) | The web ↔ engine HTTP contract |

## Running it

opersona is **self-hosted by design** — you bring a machine, and every workspace brings
its own Claude: either the **opersona bridge** (a tiny daemon on your computer that runs
the learning on the Claude subscription you already have) or an Anthropic API key. There
is no shared platform account. The short version:

**One command on a fresh Ubuntu/Debian box** — Node, Postgres, the app, systemd
services, and TLS if you pass a domain:

```bash
curl -fsSL https://opersona.me/install | bash -s -- --domain persona.example.com
```

It generates every secret locally and sends nothing anywhere. Read it first —
it's plain text at that URL, identical to [`deploy/install.sh`](deploy/install.sh),
and `--dry-run` prints what it would do without touching the machine.

Or by hand (Node 22, pnpm 9, Postgres 16):

```bash
cp .env.example .env      # set DATABASE_URL, ENGINE_INTERNAL_TOKEN, BETTER_AUTH_*, SECRETS_KEK;
                          # see docs/self-hosting.md for first-run
pnpm install
pnpm db:migrate           # fresh DB; a database from before the 2026-08 migration
                          # squash needs `pnpm db:baseline` once first
pnpm dev                  # web :3000, engine :4000
```

The full walk-through — reverse proxy, systemd units, backups, and what the
installer does *not* do for you — is in [docs/self-hosting.md](docs/self-hosting.md).

## Roadmap

- **Deployability** — docker-compose + first-run bootstrap, so "clone, compose up, sign in" is
  the whole install.
- Email invites, org knowledge base, persona-to-persona messaging.

## Mobile

Works properly on phones — dedicated layouts, not shrunken desktop.

<img src="docs/images/signin-mobile.png" width="320" alt="Sign in on mobile" />

## License

[AGPL-3.0-or-later](LICENSE). Run it, self-host it, fork it, take your data and
leave. The one condition: if you run a modified version as a service other
people use, publish your changes.
