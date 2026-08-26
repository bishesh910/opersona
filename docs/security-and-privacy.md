# Security & privacy

The stance, in one line: **enforcement over surveillance.** The system is kept safe by making
abuse technically impossible, not by anyone reading anyone's messages.

## Authentication

- **Invite-only.** There is no open sign-up (`ALLOW_SIGNUP=false`, the shipped default — the
  flag exists only to bootstrap the first account); the sign-up form is reachable only through a live,
  database-verified invitation whose email becomes the (locked) account email. Invite ids are
  long random tokens; forged or expired ids are rejected server-side. A database-level hook
  enforces the invite requirement on **every** account-creation path — including social
  sign-in, which would otherwise self-provision around the invite gate.
- **Mandatory TOTP two-factor auth** for every account, with backup codes. 2FA enrollment
  happens at first sign-in and cannot be skipped.
- Rate-limiting and auth-failure tracking on the auth endpoints.
- **Long-lived, revocable sessions** — a 60-day sliding window (each active day renews it),
  so people are effectively never logged out. Safety comes from revocation, not expiry:
  every session is a database row checked on each request, and Settings -> Account -> Devices
  lists them all (device, IP, last active) with per-device sign-out and a
  "sign out all other devices" sweep. Changing your password also revokes other sessions.

## Boundary between browser, web, and engine

The engine is never exposed to browsers. Every request passes through the web app's proxy,
which authenticates the session, resolves org membership, checks per-resource ownership, injects
the server-side org/user identity (never trusted from the client), and forwards with an internal
bearer token. The engine independently re-validates inputs.

## Containment (why nobody has to watch)

- **Code execution** is jailed by kernel namespaces (bubblewrap): no network, read-only system,
  one writable per-conversation folder, no privilege escalation, hard timeouts. See
  [chat-and-sandbox.md](chat-and-sandbox.md).
- **File tools** (Read/Write/Edit/Glob/Grep) are path-confined to the same folder.
- **WebFetch is disabled** in chats — with private data on the box, free-form URL fetching is an
  exfiltration channel.
- **Secrets are scrubbed** (`redactSecrets`) from stored transcripts and attachment text before
  they touch the database.
- Privileged, non-sandboxed tool calls require an explicit human approval with a deny-on-timeout.

## The privacy model

**Only you can see:** your conversations (past and live streams), files your chats produce, your
persona's episodic memory, the "How I think" evidence quotes, self-tests, imports, and persona
exports. There is **no admin view of any of this** — not a page, not a stream, not an API. The
UI hides the tabs; the proxy denies the requests.

**Org-visible:** your persona's public identity (name, Pixie, brief, personality, attached
documents), its **confirmed** thinking patterns as distilled descriptions only (never the
evidence quotes, never emerging patterns), and its self-test accuracy stat. Admins additionally see governance metadata: the
member list, usage totals, approvals.

**Disclosed, not buried:** when someone talks *to your persona*, you (its owner) can read that
conversation — it's a conversation with your persona. The same applies in reverse. The in-app
**Privacy page** states all of this in plain words.

**The honest caveat, stated in-app too:** this is self-hosted software. Whoever operates the
machine can — like any IT administrator anywhere — technically access the underlying database.
The application gives them no way to browse anyone's content; true cryptographic prevention
(E2E encryption) is fundamentally incompatible with a server-side AI that must read messages to
answer them, and we'd rather say that plainly than sell a false promise.

## Known trade-offs

- Persona data is as sensitive as data gets (it describes how a person thinks). Export and
  deletion are owner-controlled; per-user at-rest encryption is a roadmap item (it protects
  disks and backups — it does not, and cannot, restrain the machine's operator).
- Host-login mode ties the deployment to one Claude subscription — by design, for personal /
  small-team self-hosting. Multi-tenant setups should use per-org API keys.
- If you enable the sandbox via a passwordless-sudo rule for `bwrap`, understand what that
  means: the engine's OS user becomes root-equivalent on the host, so a compromise of the
  engine process is a compromise of the machine. Prefer an AppArmor profile permitting
  unprivileged `bwrap` where your distro allows it; the sudo route is the quick path, not the
  recommendation.
