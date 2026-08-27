# Self-hosting (the honest edition)

opersona is built to be taken home: clone it, run it on your own box, sign in with your own
Claude. This page is candid about what's automated and what's still hands-on. A one-command
installer (docker-compose + first-run bootstrap) is the top roadmap item; until then, this is
the map.

## Requirements

| Piece | Version / notes |
| --- | --- |
| Linux host | tested on Ubuntu 24.04 |
| Node | 22.x (fnm or nvm is fine) + pnpm 9 |
| Postgres | plain 16 — full-text search uses the built-in `tsvector`; no extensions required |
| Claude access | per workspace: an **opersona bridge** on the user's machine (their Claude subscription, no key) and/or their own Anthropic API key; `ANTHROPIC_API_KEY` in `.env` is an optional install-wide fallback |
| bubblewrap | for chat code execution (`apt install bubblewrap`) |
| Reverse proxy | anything that can TLS + stream SSE (Caddy config is what we run) |

## Setup

```bash
git clone https://github.com/bishesh910/opersona && cd opersona
cp .env.example .env
# .env essentials:
#   DATABASE_URL            postgres connection string
#   ENGINE_INTERNAL_TOKEN   long random string (web ↔ engine auth)
#   BETTER_AUTH_SECRET      long random string
#   BETTER_AUTH_URL         your public origin, e.g. https://opersona.example.com
#   SECRETS_KEK             32 bytes base64 (openssl rand -base64 32); encrypts
#                           workspace API keys at rest
#   ALLOW_SIGNUP            true = anyone can register (each account gets a personal
#                           workspace); false = invite-only
#   RESEND_API_KEY/EMAIL_FROM  optional mailer — enables email verification + password reset
#   REQUIRE_2FA             true to make two-factor mandatory (default: optional + nudged)
#   PLATFORM_ADMIN_EMAILS   comma-separated emails allowed to create organizations
pnpm install
pnpm -C packages/db migrate
pnpm dev          # web on :3000, engine on :4000 — or run both under systemd for real use
```

For production we run two systemd units (web: `next build` + `next start`; engine: `tsx
src/server.ts`) behind Caddy with `flush_interval -1` on the reverse proxy so SSE streams
aren't buffered.

## Sandbox host setup

Chat code execution shells out to `sbx/run.sh`, which needs:

1. `bubblewrap` installed;
2. the engine's user able to invoke it with the privileges bubblewrap needs on your distro.
   On Ubuntu 24.04, unprivileged user namespaces are restricted by AppArmor — prefer granting
   an AppArmor profile for `bwrap`; the quick alternative is passwordless sudo scoped to
   `/usr/bin/bwrap` specifically (understand the trade-off — see
   [security-and-privacy.md](security-and-privacy.md), Known trade-offs). The runner validates
   its target directory against the engine data root before anything runs;
3. whatever interpreters/libraries you want available inside the jail, installed on the host —
   the jail sees the system's read-only `/usr`. Recommended starter set:

```bash
apt install python3-numpy python3-pandas python3-scipy python3-pil python3-matplotlib \
            python3-openpyxl python3-docx python3-lxml python3-bs4 python3-yaml \
            python3-sympy python3-networkx python3-qrcode python3-pypdf2 \
            python3-reportlab imagemagick ghostscript zip unzip
# Node inside the jail: install Node system-wide (under /usr) or via fnm's default
# layout (auto-detected by sbx/run.sh); nvm installs are NOT visible to the jail.
```

Set `OPERSONA_SBX_ENABLED=false` to run without a sandbox — chat code execution is then
disabled entirely: chats keep web search and the read-only file tools, but Bash/Write/Edit are
not offered at all. Run `sbx/selftest.sh` after setup to verify the jail's guarantees on your
host.

## First run

1. Bootstrap the first account: set `ALLOW_SIGNUP=true` and put your email in
   `PLATFORM_ADMIN_EMAILS`, start the app, sign up, create your org — then set
   `ALLOW_SIGNUP=false`. From that point on, sign-up is invite-only.
2. Every account is walked through mandatory TOTP setup at first sign-in.
3. Onboarding: selfie or dice-roll your Pixie, optionally import history (claude.ai / Claude
   Code / ChatGPT exports), start chatting — extraction runs on session end.

## What's not automated yet

- No docker-compose / installer (planned; the sandbox prerequisites above are exactly what it
  will script).
- No email delivery — invitations are copy-link.
- Database backups, TLS, and monitoring are yours to arrange, as with any self-hosted service.
