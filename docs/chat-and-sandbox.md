# Chat & the code-execution sandbox

The chat is meant to feel like claude.ai on your own hardware: streaming replies, web search,
attachments, real code execution with files handed back — with the security story done properly.

## Chat features

- **Web search** is on (server-side at Anthropic). WebFetch stays **off** — with sandboxed code
  and private data on the same box, arbitrary URL fetching is an exfiltration channel we simply
  don't open.
- **Per-conversation model & effort** overrides, with org defaults.
- **Attachments** (up to 8 × 10 MB): images go to vision; PDFs are text-extracted; text/code is
  inlined; **zips** are unpacked in memory into a file tree + contents (entry/size/total budgets,
  binaries listed but not inlined — a zip bomb costs nothing). Every attachment is *also* written
  into the conversation's working directory, so sandboxed code can process the real bytes —
  upload a zip, ask for a chart of the CSV inside it, download the PNG.
- **File downloads.** After each turn the working directory is diffed; new or changed files
  appear as download chips under the reply (images preview inline) and persist in history.
- Auto-titled conversations, pinning, drag-to-pin, owner-reviewable visitor conversations.

## The sandbox

Chat Bash is rewritten — in `canUseTool`, before execution — to run through `sbx/run.sh`, which
confines the command with **bubblewrap** (the same isolation tool Claude Code itself uses on
Linux):

| Property | How |
| --- | --- |
| No network | new network namespace — `curl` gets "network is unreachable" |
| No host filesystem | `/usr` and `/etc` read-only; **only the conversation's own workdir is writable**; no `/home`, no repo, no engine data |
| No privileges | `setpriv --no-new-privs` back to an unprivileged uid — `sudo`/setuid are dead inside |
| No runaway | wall-clock timeout with kill; fresh namespace per command (files persist in the workdir, processes don't) |
| Writable temp | `/tmp` is a per-command tmpfs (so `tempfile`, matplotlib caches, etc. work) |

Because a command physically cannot reach anything outside its folder, sandboxed execution runs
**without human-approval prompts** — that's the point of building the jail. `Write`/`Edit`/`Read`
/`Glob`/`Grep` are path-checked to the same workdir. Anything else still goes through the
approvals flow.

Available inside the jail is whatever the host installs (the jail sees a read-only `/usr`) —
the recommended starter set is in [self-hosting.md](self-hosting.md). Node is available when
installed system-wide or via fnm's default layout (auto-detected by `sbx/run.sh`); nvm installs
are not picked up. Adding Python libraries is one `apt install` on the host — no code change,
no restart.

The download endpoint validates every requested path against the conversation's own folder —
traversal and absolute paths get a 404 — and (like the SSE stream) is only served to the
conversation's author or the persona's owner.

## Honest limits

- Each Bash call is a fresh namespace: env vars and background processes don't survive between
  commands; files in the workdir do.
- No network inside means no `pip install` mid-task — the library set is curated on the host.
- The host must provide bubblewrap and its invocation path; see
  [self-hosting.md](self-hosting.md).
