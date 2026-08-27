# opersona desktop

**Claude Code that thinks like you.** A macOS app that runs the real `claude`
CLI locally, in a folder you pick, with your opersona persona as its system
prompt. Full tools, your own Claude subscription, nothing executes on our
servers — the site is never in the loop.

This is the pivot: opersona.me builds and shares your persona; **this app runs
it**. It fetches your persona prompt from `opersona.me/bridge/prompt` using the
bridge token already on your machine (`~/.opersona-bridge/config.json`), then
runs Claude Code locally via the Agent SDK (your subscription) and renders the
stream as a native chat GUI — message bubbles, tool cards, a composer — not a
terminal.

## Run it (macOS)

```sh
cd apps/desktop
npm install        # builds node-pty for Electron, restores spawn-helper +x
npm run dev        # opens the window
```

You need:
- the `claude` CLI installed and logged in (`claude` in your PATH),
- this machine paired to opersona.me (Settings → Claude access), so the bridge
  token exists locally.

Then: pick a folder → Start. A real Claude Code session opens, thinking like you.
Every tool still asks you in the terminal — you approve in the TUI, as usual.

## Build a .app / .dmg (macOS)

```sh
npm run dist:mac   # unsigned dmg + zip in dist/ (arm64)
```

## Architecture (why it's shaped this way)

The load-bearing details are lifted from a proven Electron+Claude wrapper:

- **`src/main/agent.ts`** — runs Claude Code via the Agent SDK `query()` on the
  user's subscription (API key stripped from env), cwd = the chosen folder,
  persona as the system prompt; streams typed events to the renderer.
- **`src/main/persona.ts`** — fetch the persona prompt with the bridge token.
- **`src/renderer/src/App.tsx`** — the native chat GUI (sidebar, home, message
  bubbles, tool + approval cards, composer). No terminal.
- **`build/entitlements.mac.plist`** — `disable-library-validation` so the
  bundled agent runtime can load.

The persona prompt is kept byte-stable per session (no dates/counters) so
Anthropic's prompt cache isn't defeated every turn.
