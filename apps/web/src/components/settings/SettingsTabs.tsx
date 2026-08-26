'use client';
import { useEffect, useState } from 'react';

const TABS = [
  { key: 'account', label: 'Account' },
  { key: 'org', label: 'Workspace' },
  { key: 'models', label: 'Models' },
] as const;
type Key = (typeof TABS)[number]['key'];

/** Settings sections as tabs. Children order must match: [account, org, models];
 *  a null child hides its tab (e.g. Organization for non-admins). */
export function SettingsTabs({ account, org, models }: { account: React.ReactNode; org?: React.ReactNode; models: React.ReactNode }) {
  const [tab, setTab] = useState<Key>('account');
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (h === 'org' || h === 'models' || h === 'account') setTab(h);
  }, []);
  const pick = (k: Key) => { setTab(k); try { history.replaceState(null, '', `#${k}`); } catch { /* ignore */ } };
  const visible = TABS.filter((t) => t.key !== 'org' || org);
  return (
    <div>
      <div className="flex gap-1.5" role="tablist" aria-label="Settings sections">
        {visible.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => pick(t.key)}
            className={
              'rounded-full border px-3.5 py-1.5 text-sm transition-colors ' +
              (tab === t.key
                ? 'border-neutral-900 bg-neutral-900 font-medium text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                : 'border-neutral-300 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300')
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={tab === 'account' ? 'mt-4 space-y-4' : 'hidden'}>{account}</div>
      {org && <div className={tab === 'org' ? 'mt-4 space-y-4' : 'hidden'}>{org}</div>}
      <div className={tab === 'models' ? 'mt-4 space-y-4' : 'hidden'}>{models}</div>
    </div>
  );
}
