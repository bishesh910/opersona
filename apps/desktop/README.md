# opersona desktop

**Claude Code that thinks like you.** A macOS app that runs the real `claude`
CLI locally, in a folder you pick, with your opersona persona as its system
prompt. Full tools, your own Claude subscription, nothing executes on our
servers — the site is never in the loop.

This is the pivot: opersona.me builds and shares your persona; **this app runs
it**. It fetches your persona prompt from `opersona.me/bridge/prompt` using the
bridge token already on your machine (`~/.opersona-bridge/config.json`), then
spawns `claude --append-system-prompt <persona> --add-dir <folder>` in a
node-pty and renders it in xterm.

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

- **`src/main/shellEnv.ts`** — capture PATH from a fenced login shell (a
  Dock-launched app inherits almost none) and resolve the `claude` binary.
- **`src/main/ptyEnv.ts`** — strip inherited `CLAUDE(CODE|_)*` vars (an inherited
  `CLAUDE_CODE_CHILD_SESSION` silently disables transcript writing and kills
  `--resume`) and set TERM + locale (no locale → MacRoman mojibake).
- **`src/main/pty.ts`** — one node-pty session per id, session-identity guarded.
- **`src/main/persona.ts`** — fetch the persona prompt with the bridge token.
- **`src/renderer/src/terminal.ts`** — xterm with Unicode11 + allowProposedApi,
  resize only when cols/rows actually change, redraw after open.
- **`tools/ensure-pty-perms.cjs`** — restore `+x` on node-pty's spawn-helper.
- **`build/entitlements.mac.plist`** — `disable-library-validation` so a
  differently-signed `claude` can be spawned and node-pty can load.

The persona prompt is kept byte-stable per session (no dates/counters) so
Anthropic's prompt cache isn't defeated every turn.
