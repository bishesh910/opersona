/** One-shot relay: the password typed at sign-in is offered ONCE to the 2FA enrollment
 *  that immediately follows (mandatory-2FA flow), so the user isn't asked to retype it
 *  seconds later. sessionStorage (this tab only), cleared on read, 3-minute TTL. */
const KEY = 'op.pwr';

export function stashPassword(p: string): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ p, t: Date.now() })); } catch { /* private mode */ }
}

export function takePassword(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY); // one-shot, always
    if (!raw) return null;
    const { p, t } = JSON.parse(raw) as { p: string; t: number };
    return Date.now() - t < 3 * 60_000 ? p : null;
  } catch { return null; }
}
