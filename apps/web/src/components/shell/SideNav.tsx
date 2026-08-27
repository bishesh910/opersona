'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const I = {
  office: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 21V5.5L12 3l8 2.5V21M4 21h16M9 21v-4h6v4" /><path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01" /></svg>,
  plus: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>,
  persona: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5" /></svg>,
  users: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="9" cy="8" r="3" /><path d="M3 20c1-2.8 3.2-4.3 6-4.3s5 1.5 6 4.3" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 15.4c2.1.3 3.7 1.6 4.5 3.8" /></svg>,
  check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.6-4.8" /></svg>,
  compass: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></svg>,
  gear: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M4.2 12H1.8M22.2 12h-2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" /></svg>,
} as const;

const ITEMS = [
  { href: '/chat', label: 'New chat', shortLabel: 'New', icon: I.plus },
  { href: '/me', label: 'Me', icon: I.persona },
  { href: '/clones', label: 'Opersonas', icon: I.users },
  { href: '/command-center', label: 'Command Center', shortLabel: 'Center', icon: I.office, badge: 'beta' },
  { href: '/explore', label: 'Explore', icon: I.compass },
  { href: '/approvals', label: 'Approvals', icon: I.check },
  { href: '/settings', label: 'Settings', icon: I.gear },
];

const LEAN = new Set(['/chat', '/approvals']); // desktop sidebar: the rest live in the account menu

export function SideNav({ horizontal = false, include }: { horizontal?: boolean; include?: string[] }) {
  const path = usePathname();
  const items = include ? ITEMS.filter((it) => include.includes(it.href)) : horizontal ? ITEMS : ITEMS.filter((it) => LEAN.has(it.href));
  return (
    <ul className={horizontal ? 'nav-scroll gap-1' : 'space-y-0.5'}>
      {items.map((it, idx) => {
        const active = path === it.href || path.startsWith(it.href + '/');
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              className={
                'flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm ' +
                (active
                  ? 'bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-50'
                  : 'text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/60')
              }
            >
              <span className="opacity-70">{it.icon}</span>{horizontal && 'shortLabel' in it && it.shortLabel ? it.shortLabel : it.label}{'badge' in it && it.badge ? <span className="ml-1 rounded bg-amber-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">{it.badge}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
