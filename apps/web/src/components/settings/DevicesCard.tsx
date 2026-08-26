'use client';
import { useState, useTransition } from 'react';
import { revokeDeviceSession, revokeInactiveDeviceSessions, revokeOtherDeviceSessions } from '@/actions/sessions';
import { ConfirmDialog } from '@/components/shell/Dialog';

export interface DeviceSessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO — last time better-auth re-stamped the row (≤ daily)
  current: boolean;
  /** not used in 2+ days — computed server-side so SSR and hydration agree */
  stale: boolean;
}

/** "Chrome on Linux" from a raw user-agent; honest fallback when unknown. */
function describeDevice(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: 'Unknown device', mobile: false };
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPod/.test(ua) ? 'iOS'
    : /iPad/.test(ua) ? 'iPadOS'
    // iPadOS Safari masquerades as a Mac, so hedge the way Apple's own device lists do
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac or iPad'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : null;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/.test(ua);
  if (browser && os) return { label: `${browser} on ${os}`, mobile };
  return { label: browser ?? os ?? 'Unknown device', mobile };
}

/** Relative time for "signed in" (createdAt is exact). */
function ago(iso: string): string {
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 90) return 'just now';
  const min = sec / 60;
  if (min < 60) return `${Math.round(min)} min ago`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** Activity at DAY granularity — updatedAt is only re-stamped at most once per day,
 *  so anything finer would overstate what we actually know. */
function activeDay(iso: string): string {
  const then = new Date(iso); const now = new Date();
  const days = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      - new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

function DeviceIcon({ mobile }: { mobile: boolean }) {
  return mobile ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="7" y="2.5" width="10" height="19" rx="2" /><path d="M11 18.5h2" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function SessionRow({ s, busy, onRevoke }: { s: DeviceSessionRow; busy: string | null; onRevoke: (id: string) => void }) {
  const d = describeDevice(s.userAgent);
  return (
    <li className={'flex items-center gap-3 py-2.5' + (s.stale ? ' opacity-70' : '')}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        <DeviceIcon mobile={d.mobile} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="truncate font-medium">{d.label}</span>
          {s.current && <span className="chip shrink-0">this device</span>}
        </div>
        <p className="muted break-words text-xs" suppressHydrationWarning>
          {s.ipAddress ?? 'unknown IP'} · active {activeDay(s.updatedAt)} · signed in {ago(s.createdAt)}
        </p>
      </div>
      {!s.current && (
        <button
          type="button"
          onClick={() => onRevoke(s.id)}
          disabled={busy !== null}
          aria-label={`Sign out ${d.label}${s.ipAddress ? ` (${s.ipAddress})` : ''}`}
          className="min-h-10 shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 sm:min-h-0 dark:text-neutral-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          {busy === s.id ? '…' : 'Sign out'}
        </button>
      )}
    </li>
  );
}

/**
 * Active sessions across the user's devices, with per-device sign-out — the
 * counterweight to 60-day sessions. A signed-in browser holds exactly ONE
 * session; signing in again replaces the cookie and ORPHANS the previous row,
 * which lingers until its 60-day expiry. Those orphans are what "inactive"
 * groups: rows not used in 2+ days, shown apart so the active list reflects
 * reality, with a one-click purge.
 */
export function DevicesCard({ sessions }: { sessions: DeviceSessionRow[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'others' | 'inactive'>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // current device pinned first, then most recently active (server order)
  const ordered = [...sessions].sort((x, y) => Number(y.current) - Number(x.current));
  const active = ordered.filter((s) => !s.stale);
  const inactive = ordered.filter((s) => s.stale);
  const others = sessions.filter((s) => !s.current).length;

  const run = (busy: string, fn: () => Promise<void>, failText: string) => {
    setBusyId(busy); setError(null);
    startTransition(async () => {
      try { await fn(); }
      catch { setError(failText); }
      finally { setBusyId(null); setConfirm(null); }
    });
  };
  const revokeOne = (id: string) => run(id, () => revokeDeviceSession(id), "Couldn't sign that device out — try again.");

  return (
    <section className="card" data-devices>
      <h2 className="font-medium">Devices</h2>
      <p className="muted mt-0.5 text-xs">
        Where your account is signed in now. Sessions last 60 days and renew while you use them;
        signing a device out here takes effect on its next request. Device names, addresses, and
        activity are approximate — activity is tracked to the day, not the minute.
      </p>
      <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
        {active.map((s) => <SessionRow key={s.id} s={s} busy={busyId} onRevoke={revokeOne} />)}
      </ul>
      {inactive.length > 0 && (
        <div className="mt-2 border-t border-neutral-100 pt-2 dark:border-neutral-800" data-inactive>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              aria-expanded={showInactive}
              onClick={() => setShowInactive((v) => !v)}
              className="muted flex min-h-10 items-center gap-1.5 text-xs hover:text-neutral-700 sm:min-h-0 dark:hover:text-neutral-300"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                className={'transition-transform ' + (showInactive ? 'rotate-90' : '')} aria-hidden><path d="M9 6l6 6-6 6" /></svg>
              {inactive.length} inactive {inactive.length === 1 ? 'session' : 'sessions'} — not used in 2+ days
            </button>
            <button
              type="button"
              className="min-h-10 rounded-lg px-2 py-1 text-xs font-medium text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 sm:min-h-0 dark:text-neutral-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              disabled={busyId !== null}
              onClick={() => { setError(null); setConfirm('inactive'); }}
            >
              {busyId === 'inactive' ? '…' : 'Sign out all inactive'}
            </button>
          </div>
          <p className="muted mt-0.5 text-[11px]">
            Mostly old sign-ins from these same browsers — each new sign-in replaces the cookie, and the
            old session stays listed until it expires. Safe to clear; a device you still use just signs in again.
          </p>
          {showInactive && (
            <ul className="mt-1 divide-y divide-neutral-100 dark:divide-neutral-800">
              {inactive.map((s) => <SessionRow key={s.id} s={s} busy={busyId} onRevoke={revokeOne} />)}
            </ul>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {others > 0 && (
        <div className="mt-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <button type="button" className="btn-secondary text-xs" disabled={busyId !== null} onClick={() => { setError(null); setConfirm('others'); }}>
            Sign out all other devices
          </button>
        </div>
      )}
      {confirm === 'others' && (
        <ConfirmDialog
          title="Sign out other devices?"
          message={`${others} other ${others === 1 ? 'session' : 'sessions'} will be signed out immediately. This device stays signed in.`}
          confirmLabel="Sign out others"
          busy={busyId === 'others'}
          onCancel={() => { if (busyId !== 'others') setConfirm(null); }}
          onConfirm={() => {
            if (busyId !== null) return;
            run('others', revokeOtherDeviceSessions, "Couldn't sign the other devices out — try again.");
          }}
        />
      )}
      {confirm === 'inactive' && (
        <ConfirmDialog
          title="Sign out inactive sessions?"
          message={`${inactive.length} ${inactive.length === 1 ? 'session' : 'sessions'} not used in over 2 days will be signed out. If one of them is a device you still use, it will simply ask you to sign in again.`}
          confirmLabel="Sign out inactive"
          busy={busyId === 'inactive'}
          onCancel={() => { if (busyId !== 'inactive') setConfirm(null); }}
          onConfirm={() => {
            if (busyId !== null) return;
            run('inactive', revokeInactiveDeviceSessions, "Couldn't clear the inactive sessions — try again.");
          }}
        />
      )}
    </section>
  );
}
