'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';
import { ThemeToggle } from './ThemeToggle';
import { ChatSearch } from './ChatSearch';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import { PixelChevronUp } from './PixelGlyphs';
import type { AvatarRecipe } from '@opersona/shared';
import { randomRecipe } from '@/components/onboarding/random-recipe';

const GEAR = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M4.2 12H1.8M22.2 12h-2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7" /></svg>;
const OUT = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 8 6 12l4 4M6 12h10" /></svg>;

/** One cropped Pixie head in a ringed tile — the zoom that stays legible at icon size. */
function HeadTile({ recipe, name, size = 22, className = '' }: { recipe: AvatarRecipe | null; name: string; size?: number; className?: string }) {
  // AvatarThumb at scale 2 renders a 36×56 CSS-px canvas; the head lives in a
  // ~24×24 window at (6,3). Center that window inside a `size` tile.
  const off = (24 - size) / 2;
  return (
    <span className={'overflow-hidden ' + className} style={{ width: size, height: size }}>
      <span className="block" style={{ marginLeft: -(6 + off), marginTop: -(3 + off) }}>
        <AvatarThumb recipe={recipe} name={name} scale={2} />
      </span>
    </span>
  );
}

export function SidebarFooter({ name, email, avatarRecipe }: {
  name: string; email: string; avatarRecipe?: AvatarRecipe | null;
}) {
  // decorative random strangers for the Opersonas button (fresh faces each visit, nobody's real Pixie)
  const [crowd, setCrowd] = useState<AvatarRecipe[]>([]);
  useEffect(() => { setCrowd([randomRecipe(), randomRecipe(), randomRecipe(), randomRecipe(), randomRecipe()]); }, []);
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pop, setPop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const pad = (active: boolean) =>
    'flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-neutral-200/60 dark:hover:bg-neutral-800 ' +
    (active ? 'bg-neutral-200/80 dark:bg-neutral-800' : '');
  return (
    <div ref={ref} className="relative flex items-center justify-between">
      {/* you → Me */}
      <Link href="/me" title={`${name} — your persona`} aria-label="Me" className={pad(path.startsWith('/me'))} onClick={() => setPop((n) => n + 1)}>
        <span key={pop} className={pop ? 'pixie-pop inline-block' : 'inline-block'}>
          {avatarRecipe
            ? <HeadTile recipe={avatarRecipe} name={name} size={26} className="block" />
            : <AvatarThumb recipe={avatarRecipe} name={name} scale={1.25} />}
        </span>
      </Link>
      {/* the others → Opersonas */}
      <Link href="/opersonas" title="Opersonas" aria-label="Opersonas" className={pad(path.startsWith('/opersonas'))}>
        {/* a little crowd: three heads in back, two in front, tightly packed */}
        <span className="relative block h-8 w-11">
          {crowd[0] && <HeadTile recipe={crowd[0]} name="?" size={18} className="absolute left-0 top-0" />}
          {crowd[1] && <HeadTile recipe={crowd[1]} name="?" size={18} className="absolute left-1/2 top-0 -translate-x-1/2" />}
          {crowd[2] && <HeadTile recipe={crowd[2]} name="?" size={18} className="absolute right-0 top-0" />}
          {crowd[3] && <HeadTile recipe={crowd[3]} name="?" size={19} className="absolute bottom-0 left-[5px] z-10" />}
          {crowd[4] && <HeadTile recipe={crowd[4]} name="?" size={19} className="absolute bottom-0 right-[5px] z-10" />}
        </span>
      </Link>
      <ChatSearch anchorToContainer />
      {/* ^ — settings, theme, sign out */}
      <button type="button" aria-label="Account & settings" aria-haspopup="menu" aria-expanded={open} title="Account & settings"
        className={pad(false) + ' text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'}
        onClick={() => setOpen((o) => !o)}>
        <PixelChevronUp className={'transition-transform ' + (open ? 'rotate-180' : '')} />
      </button>
      {open && (
        <div role="menu" className="card absolute bottom-full inset-x-0 z-20 mb-2 p-2 shadow-lg">
          <div className="px-2 py-1 text-xs">
            <div className="font-medium">{name}</div>
            <div className="muted truncate">{email}</div>
          </div>
          <Link href="/settings" role="menuitem" onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <span className="opacity-70">{GEAR}</span>Settings
          </Link>
          <Link href="/privacy" role="menuitem" onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">
            <span aria-hidden className="flex w-4 justify-center opacity-70">
              <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor" shapeRendering="crispEdges" aria-hidden><path d="M6 0h2v1h2v1h2v1h2v6h-1v2h-1v2h-2v1h-2v1H6v-1H4v-1H2v-2H1V9H0V3h2V2h2V1h2V0Z" opacity=".85"/></svg>
            </span>Privacy
          </Link>
          <div className="mt-2 border-t border-neutral-200 px-2 pt-2 dark:border-neutral-800"><ThemeToggle /></div>
          <button type="button" role="menuitem"
            className="mt-2 block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={async () => { await signOut(); router.push('/sign-in'); router.refresh(); }}>
            <span className="flex items-center gap-2.5"><span className="opacity-70">{OUT}</span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
