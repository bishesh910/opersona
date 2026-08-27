# opersona

Run your [opersona](https://opersona.me) on the Claude subscription you already have.

```bash
npx opersona
```

That's the whole setup. On first run it asks for a pairing token (opersona.me →
Settings → Models → *Chat on your own subscription* → **Pair a machine**) and
remembers it. From then on, while this is running:

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

## Flags

```
--token obr_…      pair (saved to ~/.opersona-bridge/config.json)
--url https://…    self-hosted opersona instance
--no-watch         don't learn from this machine's coding sessions
```
