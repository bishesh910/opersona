# Deploying opersona

Production runs as three systemd services on this box:

| Service | What | Listens |
|---|---|---|
| `opersona-engine` | Hono + Claude Agent SDK | 127.0.0.1:4000 (never exposed) |
| `opersona-web` | Next.js production build | 127.0.0.1:3000 (never exposed) |
| `caddy` | TLS + reverse proxy | :443 (and :80 → redirect) |

Firewall (ufw): only 22, 80, 443 are open.

## Everyday
```bash
sudo systemctl status opersona-engine opersona-web caddy
sudo journalctl -u opersona-web -f          # logs
```

## After changing code
```bash
cd ~/opersona && pnpm install && pnpm db:migrate
(cd apps/web && NODE_ENV=production pnpm build)
sudo systemctl restart opersona-engine opersona-web
```

## Real certificate (when you have a domain)
1. Point a DNS A record (e.g. `persona.example.com`) at this machine's public IP and forward ports 80+443 to it.
2. `sudo sed -i 's/^PUBLIC_HOST=.*/PUBLIC_HOST=persona.example.com/' /etc/caddy/opersona.env`
3. Remove the `tls internal` line from `/etc/caddy/Caddyfile`, and set `BETTER_AUTH_URL=https://persona.example.com` + add it to `TRUSTED_ORIGINS` in `~/opersona/.env`.
4. `sudo systemctl restart caddy opersona-web` — Caddy fetches a Let's Encrypt certificate automatically.

Until then the certificate is issued by Caddy's local CA: browsers warn once. To silence it, install the root cert
(`/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`) on your devices.

## Before opening to the internet — checklist
- [ ] Real domain + certificate (above)
- [ ] `ALLOW_SIGNUP` set deliberately: `true` = open registration (every account gets a
      personal workspace and brings its own Anthropic key), `false` = invite-only
- [ ] optional mailer (`RESEND_API_KEY` + `EMAIL_FROM`) if you want email verification + password reset
- [ ] `REQUIRE_2FA=true` only for locked-down installs (default: optional + nudged)
- [ ] upgrading a legacy multi-member org? `deploy/split-pilot-org.sh` (keep data) — or just
      delete the old org and let people re-register (what opersona.me did)
- [ ] Rotate `ENGINE_INTERNAL_TOKEN`, `BETTER_AUTH_SECRET`, `SECRETS_KEK` if they were ever shared
- [ ] Backups: `pg_dump opersona` nightly (persona data lives entirely in Postgres)
- [ ] Keep `pnpm audit --prod` clean

## Social sign-in (Google / Apple)
Buttons appear automatically once the env vars are set — but both providers require a REAL DOMAIN
(they reject private-IP redirect URLs), so do the domain step above first.

**Google** (free): console.cloud.google.com → APIs & Services → Credentials → Create OAuth client ID
(Web application) → authorized redirect URI: `https://<your-domain>/api/auth/callback/google` →
put client id/secret in `.env` as GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET → rebuild web + restart.

**Apple** ($99/yr developer account): developer.apple.com → Certificates → Services ID with
"Sign in with Apple", return URL `https://<your-domain>/api/auth/callback/apple`; generate the
client secret JWT per better-auth docs → APPLE_CLIENT_ID / APPLE_CLIENT_SECRET.
