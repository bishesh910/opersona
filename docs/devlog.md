# Devlog — how opersona got here

A milestone log of what was built, in order, with the reasoning. Written for future contributors
(and future us) wondering "why is it like this?".

## Phase 0 — the pilot skeleton

Monorepo (web / engine / db / shared / pixel-avatar), Postgres schema with a provenance spine on
every learned row, better-auth with orgs, the Claude Agent SDK session core (streaming input,
idle-reap + resume, SSE ring buffer), HITL approvals bridge, selfie → recipe via vision,
workspace isolation, cost logging. Verified end-to-end with prompt-cache hits on second sessions.

## The pivot that defined the product

Early direction was classic "facts + playbooks" memory. User feedback mid-build: *learn how the
human approaches things, not what the approach produced* — the 2+2 as 1+1+1+1 vs 4−2+4−2
example. Everything downstream follows from that: the reasoning-fingerprint extractor
(human-turn evidence only, reusable pattern keys, confirmation gates), "That's me / Not me"
feedback, and the rule that silence beats a wrong stereotype.

## Learning loop hardening

- Confirmed-only rendering, grouped per dimension and sorted by strength (emerging patterns are
  stored and shown in the UI but never rendered)
- Nightly pattern tidy (merge duplicate keys behind verify gates; human-accepted keys are never
  absorbed away)
- Self-tests: persona answers three fresh problems from the person's actual fields; ratings feed
  an accuracy stat; "not me" comments become counter-observations
- Episodic memory + `recall_memory`, owner-private with visitor refusals, exportable as a
  Markdown vault
- Importers: claude.ai export zips, Claude Code sessions (with growth guards against re-mining
  giant transcripts), ChatGPT/Codex exports

## Auth, made compulsory

Invite-only sign-up verified against live invitations (the invite email becomes the locked
account email), mandatory TOTP 2FA with backup codes, rate limiting, an auth-failures log, and a
password-relay so 2FA enrollment doesn't ask users to retype their password. A security pass
covered invite forgery (403 matrix), the workspace read jail, and prompt-injection surface
(WebFetch off; documents are data, not instructions).

## The chat grew up

Web search; per-conversation model/effort; attachments including in-memory zip unpacking with
hard budgets; then the big one — **sandboxed code execution**: every chat Bash call is rewritten
to run inside a bubblewrap jail (no network, workdir-only writes, no privileges, hard timeouts),
attachments are dropped into the workdir as real files, and post-turn diffs surface new files as
downloads. Verified adversarially during the pilot — network egress, host reads, privilege escalation, and
path traversal on the download endpoint all fail; `sbx/selftest.sh` re-runs those probes on any
host. Because containment is real, ordinary code runs
without approval prompts.

## Pixies v2

The original outlined sprite engine (kept for future walking sprites, pinned by a bounded-diff
regression suite) was joined by a full art-direction change to a flat, no-outline "cute pixel
portrait" style: gradient shoulder domes, tiny solid eyes, per-garment clothing details, a
real-wardrobe randomizer palette, blink/think/talk animation states. Iterated against user
feedback: fixed a literal lazy-eye in the original eyes, then over-round eyes, neck length, body
width, clothing sameness, highlighter-rainbow outfits.

## The night scene & the Night Shift auth

The sign-in/sign-up pages became a generated scene: starfield, pixel crescent moon, shooting
star, a two-layer pixel city with lit windows, and a packed crowd of calm Pixies — separate
compositions for desktop and portrait phones. The sign-in card was redesigned by a three-way
design exploration (scene-glass vs typographic minimal vs brand-playful) synthesized into
**Night Shift**: a dark-glass card like one more building in the skyline, moon-cream as the only
accent, tactile slab button, and a random Pixie peeking over the card that switches to its
thinking face while you authenticate. The redesign also fixed a latent theming bug (auth pages
are always night, but theme-dependent utility classes silently rendered light variants there).

## Privacy: enforcement over surveillance

The decision: admins govern (members, costs, approvals) but the product has **no surface that
shows anyone else's content** — chat lists, transcripts, live streams, produced files, episodic
memory, evidence quotes, self-tests, and persona exports are all owner-only, enforced in both
the UI and the proxy. An in-app Privacy page states what's visible to whom, how the system stays
safe without watching anyone, and the honest self-hosted caveat about operator database access.

## Distribution decision

No SaaS. opersona is a product you take home: run it on your machine, sign in with your Claude,
own your data. That makes the installer the real remaining product surface — see the roadmap in
the README.
