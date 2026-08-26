'use client';
import { useState, useTransition } from 'react';
import { revokeDeviceSession, revokeOtherDeviceSessions } from '@/actions/sessions';
import { ConfirmDialog } from '@/components/shell/Dialog';

export interface DeviceSessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO — last time better-auth re-stamped the row (≤ daily)
  current: boolean;
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

/**
 * Active sessions across the user's devices: what's signed in, from where, when
 * it was last used — with a per-device sign-out and a "sign out others" sweep.
 * The counterweight to 60-day sessions: convenience from the long window,
 * safety from the kill switch.
 */
export function DevicesCard({ sessions }: { sessions: DeviceSessionRow[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // current device pinned first, then most recently active
  const ordered = [...sessions].sort((x, y) => Number(y.current) - Number(x.current));
  const visible = showAll ? ordered : ordered.slice(0, 6);
  const hidden = ordered.length - visible.length;
  const others = sessions.filter((s) => !s.current).length;

  const revokeOne = (id: string) => {
    setBusyId(id); setError(null);
    startTransition(async () => {
      try { await revokeDeviceSession(id); }
      catch { setError("Couldn't sign that device out — try again."); }
      finally { setBusyId(null); }
    });
  };

  return (
    <section className="card" data-devices>
      <h2 className="font-medium">Devices</h2>
      <p className="muted mt-0.5 text-xs">
        Everywhere your account is signed in. Sessions last 60 days and renew while you use them;
        signing a device out here takes effect on its next request. Device names, addresses, and
        activity are approximate — activity is tracked to the day, not the minute.
      </p>
      <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
        {visible.map((s) => {
          const d = describeDevice(s.userAgent);
          return (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
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
                  onClick={() => revokeOne(s.id)}
                  disabled={busyId !== null}
                  aria-label={`Sign out ${d.label}${s.ipAddress ? ` (${s.ipAddress})` : ''}`}
                  className="min-h-10 shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 sm:min-h-0 dark:text-neutral-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                >
                  {busyId === s.id ? '…' : 'Sign out'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>}
      {hidden > 0 && (
        <button type="button" className="muted mt-1 flex min-h-10 items-center text-xs underline-offset-2 hover:underline sm:min-h-0" onClick={() => setShowAll(true)}>
          Show all {ordered.length} sessions
        </button>
      )}
      {others > 0 && (
        <div className="mt-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <button type="button" className="btn-secondary text-xs" disabled={busyId !== null} onClick={() => { setError(null); setConfirmOthers(true); }}>
            Sign out all other devices
          </button>
        </div>
      )}
      {confirmOthers && (
        <ConfirmDialog
          title="Sign out other devices?"
          message={`${others} other ${others === 1 ? 'session' : 'sessions'} will be signed out immediately. This device stays signed in.`}
          confirmLabel="Sign out others"
          busy={busyId === 'others'}
          onCancel={() => { if (busyId !== 'others') setConfirmOthers(false); }}
          onConfirm={() => {
            if (busyId !== null) return;
            setBusyId('others'); setError(null);
            startTransition(async () => {
              try { await revokeOtherDeviceSessions(); }
              catch { setError("Couldn't sign the other devices out — try again."); }
              finally { setBusyId(null); setConfirmOthers(false); }
            });
          }}
        />
      )}
    </section>
  );
}
