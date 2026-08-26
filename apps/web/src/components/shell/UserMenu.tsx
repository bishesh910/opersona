'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';
import { ThemeToggle } from './ThemeToggle';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import type { AvatarRecipe } from '@opersona/shared';

const MENU_ICONS: Record<string, React.ReactNode> = {
  '/me': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.2 3.8-5 7-5s5.8 1.8 7 5" /></svg>,
  '/clones': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="9" cy="8" r="3" /><path d="M3 20c1-2.8 3.2-4.3 6-4.3s5 1.5 6 4.3" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 15.4c2.1.3 3.7 1.6 4.5 3.8" /></svg>,
  '/office': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 21V5.5L12 3l8 2.5V21M4 21h16M9 21v-4h6v4" /><path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01" /></svg>,
  '/settings': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M4.2 12H1.8M22.2 12h-2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" /></svg>,
  '/privacy': <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor" shapeRendering="crispEdges" aria-hidden><path d="M6 0h2v1h2v1h2v1h2v6h-1v2h-1v2h-2v1h-2v1H6v-1H4v-1H2v-2H1V9H0V3h2V2h2V1h2V0Z" opacity=".85" /></svg>,
};
const SIGN_OUT_ICON = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 8 6 12l4 4M6 12h10" /></svg>;

const initials = (name: string) =>
  name.trim().split(/\s+/).map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('') || '?';

export function UserMenu({ name, email, avatarRecipe, dropUp = false, compact = false }: { name: string; email: string; avatarRecipe?: AvatarRecipe | null; dropUp?: boolean; compact?: boolean }) {
  const [pop, setPop] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className={compact ? "static" : "relative"}>
      <button
        type="button"
        className={compact
          ? 'flex items-center justify-center rounded-lg p-1 transition-colors hover:bg-neutral-200/60 dark:hover:bg-neutral-800'
          : 'flex items-center gap-2 rounded-lg border border-neutral-200 py-1 pl-1 pr-2.5 text-sm hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-800/60'}
        onClick={() => { setOpen((o) => !o); setPop((n) => n + 1); }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
      >
        <span key={pop} className={pop ? 'pixie-pop inline-block' : 'inline-block'}>
          <AvatarThumb recipe={avatarRecipe} name={name} scale={1.5} />
        </span>
        {!compact && <span className="hidden sm:inline">{initials(name)}</span>}
      </button>
      {open && (
        <div role="menu" className={"card absolute z-20 w-56 p-2 shadow-lg " + (dropUp ? (compact ? "bottom-full inset-x-0 mb-2" : "bottom-full left-0 mb-1") : "right-0 mt-1")}>
          <div className="px-2 py-1 text-xs">
            <div className="font-medium">{name}</div>
            <div className="muted truncate">{email}</div>
          </div>
          <nav className="mt-1 border-t border-neutral-200 pt-1 dark:border-neutral-800">
            {[['/me', 'Me'], ['/clones', 'Opersonas'], ['/office', 'Command Center (beta)'], ['/settings', 'Settings'], ['/privacy', 'Privacy']].map(([href, label]) => (
              <Link key={href} href={href} role="menuitem" onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"><span className="opacity-70">{MENU_ICONS[href]}</span>{label}</Link>
            ))}
          </nav>
          <div className="mt-2 border-t border-neutral-200 px-2 pt-2 dark:border-neutral-800"><ThemeToggle /></div>
          <button
            type="button"
            role="menuitem"
            className="mt-2 block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={async () => { await signOut(); router.push('/sign-in'); router.refresh(); }}
          >
            <span className="flex items-center gap-2.5"><span className="opacity-70">{SIGN_OUT_ICON}</span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
