'use client';
/**
 * Command Center — the surviving piece of the office experiment, now a clean
 * full-page surface (structure after the munder-difflin reference: portrait
 * header, "<name> runs the floor", tab grid, content).
 *
 * The boss is a persona YOU appoint (★). It delegates work to the best-suited
 * persona, hires temporary specialists with boss-authored job descriptions,
 * and archives them between engagements — all from Dispatch, all on the record.
 */
import { useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AvatarRecipe } from '@opersona/shared';
import { setBossAction } from '@/actions/office';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import { OfficeChat } from './OfficeChat';
import { TeamTab, TasksTab, ActivityTab, MonitorTab, AskMeTab } from './CommandCenter';

export interface CCMember {
  id: string;
  name: string;
  recipe: AvatarRecipe | null;
  role: string;
  hired: boolean;
  boss: boolean;
  mine: boolean;
}

const TABS = [
  { key: 'dispatch', label: 'dispatch', icon: '>_' },
  { key: 'monitor', label: 'monitor', icon: '◇' },
  { key: 'tasks', label: 'tasks', icon: '✓' },
  { key: 'askme', label: 'ask me', icon: '‼' },
  { key: 'team', label: 'team', icon: '⛉' },
  { key: 'activity', label: 'activity', icon: '◷' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function CommandCenterView({ members, bossCloneId, canStar }: {
  members: CCMember[];
  bossCloneId: string | null;
  canStar: boolean;
}) {
  const [tab, setTab] = useState<TabKey>('dispatch');
  const [choosing, setChoosing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const [, start] = useTransition();
  const boss = members.find((m) => m.id === bossCloneId) ?? null;

  const star = useCallback((cloneId: string | null) => {
    start(async () => {
      try { setErr(null); await setBossAction(cloneId); setChoosing(false); router.refresh(); }
      catch (e) { setErr(e instanceof Error ? e.message : 'Could not set the boss'); }
    });
  }, [router]);

  // keep the ChatView tool events flowing to the Team/Tasks/Activity listeners
  useEffect(() => { setTab((t) => t); }, [bossCloneId]);

  if (!boss) {
    return (
      <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-4 text-center">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-500">Command Center</p>
        <h1 className="text-lg font-semibold">No one runs the floor yet</h1>
        <p className="muted max-w-md text-sm">
          Appoint a boss: a persona that distributes work to whoever fits it best and hires
          temporary specialist personas when the team is busy or a skill is missing.
          {!canStar && ' Ask an org admin to pick one.'}
        </p>
        {canStar && (
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {members.filter((m) => !m.hired).map((m) => (
              <button key={m.id} type="button" onClick={() => star(m.id)}
                className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 transition-colors hover:border-amber-400 hover:bg-amber-50 dark:border-neutral-800 dark:hover:border-amber-600 dark:hover:bg-amber-950/30">
                <AvatarThumb recipe={m.recipe} name={m.name} scale={1} />
                <span className="text-sm font-medium">{m.name}</span>
                <span className="text-amber-400">★</span>
              </button>
            ))}
          </div>
        )}
        {err && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{err}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      {/* header: portrait + runs-the-floor, after the reference */}
      <div className="flex items-center gap-3 pb-3">
        <AvatarThumb recipe={boss.recipe} name={boss.name} scale={2} />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-500">Command Center</p>
          <div className="flex items-baseline gap-2">
            <h1 className="truncate text-lg font-semibold">{boss.name}</h1>
            <span className="muted truncate text-sm">{boss.name.split(' ')[0]} runs the floor</span>
          </div>
        </div>
        <Link href={`/clones/${boss.id}`} className="muted shrink-0 text-xs hover:underline">full persona →</Link>
        {canStar && (
          <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setChoosing((v) => !v)}>
            change ★
          </button>
        )}
      </div>
      {choosing && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 p-2 dark:border-neutral-800">
          {members.filter((m) => !m.hired).map((m) => (
            <button key={m.id} type="button" onClick={() => star(m.id === bossCloneId ? null : m.id)}
              className={'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors '
                + (m.id === bossCloneId ? 'border-amber-400 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/30' : 'border-neutral-200 hover:border-amber-400 dark:border-neutral-800')}>
              {m.name} <span className={m.id === bossCloneId ? 'text-amber-500' : 'text-neutral-300 dark:text-neutral-600'}>★</span>
            </button>
          ))}
          <span className="muted text-[11px]">tap the current boss to remove the star</span>
        </div>
      )}
      {err && <p className="pb-2 text-xs text-red-600 dark:text-red-400" role="alert">{err}</p>}

      {/* tab grid, reference-style */}
      <div role="tablist" aria-label="Command Center" className="flex flex-wrap gap-1.5 pb-3">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors '
              + (tab === t.key
                ? 'border-amber-400 bg-amber-100/70 font-semibold text-neutral-900 dark:border-amber-600 dark:bg-amber-950/40 dark:text-neutral-100'
                : 'border-neutral-200 bg-neutral-50 text-neutral-500 hover:border-neutral-300 hover:text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200')}>
            <span aria-hidden className="opacity-70">{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
        {tab === 'dispatch' ? (
          <OfficeChat key={boss.id} cloneId={boss.id} avatar={boss.recipe} />
        ) : tab === 'monitor' ? (
          <MonitorTab />
        ) : tab === 'tasks' ? (
          <TasksTab />
        ) : tab === 'askme' ? (
          <AskMeTab />
        ) : tab === 'team' ? (
          <TeamTab />
        ) : (
          <ActivityTab />
        )}
      </div>
    </div>
  );
}
