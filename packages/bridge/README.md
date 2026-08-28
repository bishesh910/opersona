# opersona

Run your [opersona](https://opersona.me) on the Claude subscription you already have.

```bash
npx opersona@latest install --token obr_…
```

That's the whole setup — one command (opersona.me → Settings → Models → *Chat
on your own subscription* → **Pair a machine** shows it with your token filled
in). It pairs this machine, installs the bridge as an invisible background
service (launchd on macOS, a systemd user unit on Linux), starts it, and tells
you whether it actually connected. No terminal to keep open; it runs at every
login and restarts itself. `npx opersona uninstall` removes it (your pairing
is kept).

Prefer to watch it run? The same flags without `install` run it in the
foreground with logs:

```bash
npx opersona@latest --token obr_…
```

While the bridge is up:

- **Chats on opersona.me think on THIS machine** — through your own Claude Code
  login, on your own plan. No API key, ever.
- **Your persona learns from your real work**: every Claude Code / Codex CLI
  session you finish on this machine is picked up automatically and mined for
  how you think. First run backfills your whole history. (`--no-watch` to opt out.)

## What it can never do

- The web can **not** run code on your machine: sessions get read-only tools
  jailed to `~/.opersona-bridge/work`; anything else asks you first, in the
  opersona web UI.
- Your Anthropic login never leaves this machine — the bridge authenticates to
  opersona with its own token, and nothing Anthropic-related crosses the wire.
- One outbound WebSocket; nothing listens on your machine.

## Requirements

Node 20+, and [Claude Code](https://claude.com/claude-code) signed in (`claude` once).

## Commands & flags

```
install            pair + run as a background service (accepts the flags below)
uninstall          remove the background service (pairing/config kept)
grant <folder>     let chats run code + edit files in ONE folder (every command still asks)
revoke <folder>    take that back
workspaces         list granted folders

--token obr_…      pair (saved to ~/.opersona-bridge/config.json, 0600)
--seal-key …       decrypt/encrypt sealed chats on this machine (never sent to the server)
--url https://…    self-hosted opersona instance
--no-watch         don't learn from this machine's coding sessions (persists with install)
```
