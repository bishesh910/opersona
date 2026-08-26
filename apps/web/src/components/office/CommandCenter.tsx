'use client';
/**
 * Command Center tabs — the boss persona's panel body (munder-difflin's
 * CommandCenterPanel, opersona edition). Team is org-visible identity;
 * Tasks are only ever YOUR delegations, with live status so you always
 * know whether something is still working or done.
 */
import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { openCommandCenter, openActivity, setHiredArchivedAction, type ActivityEvent, type CommandCenterData } from '@/actions/office';

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function TeamTab() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const [, start] = useTransition();
  const reload = (): void => { openCommandCenter().then(setData).catch(() => {}); };
  useEffect(reload, []);
  useEffect(() => {
    const onToolResult = (e: Event): void => {
      const d = (e as CustomEvent<{ name?: string }>).detail;
      if (d?.name?.endsWith('hire_persona') || d?.name?.endsWith('archive_persona')) reload();
    };
    window.addEventListener('opersona:tool-result', onToolResult);
    return () => window.removeEventListener('opersona:tool-result', onToolResult);
  }, []);
  if (!data) return <p className="muted p-3 text-xs">loading the floor…</p>;
  const rows = [...data.team.filter((t) => !t.archived), ...data.team.filter((t) => t.archived)];
  return (
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3" data-cc-team>
      {rows.map((t) => (
        <div key={t.cloneId} className={'flex items-center gap-2 rounded-lg px-2 py-1.5 ' + (t.archived ? 'opacity-55' : 'bg-neutral-50 dark:bg-neutral-800/50')}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <span className="truncate">{t.name}</span>
              {t.boss && <span className="text-amber-500">★</span>}
              {t.kind === 'hired' && <span className="chip shrink-0">{t.archived ? 'archived' : 'hired'}</span>}
            </div>
            <p className="muted truncate text-[11px]">{t.role || (t.kind === 'hired' ? 'specialist' : 'persona')}</p>
          </div>
          {data.canManage && t.kind === 'hired' && (
            <button
              type="button"
              className="btn-secondary btn-sm shrink-0 !px-2 !py-0.5 text-[11px]"
              onClick={() => start(async () => { await setHiredArchivedAction(t.cloneId, !t.archived).catch(() => {}); reload(); })}
            >
              {t.archived ? 'rehire' : 'archive'}
            </button>
          )}
        </div>
      ))}
      <p className="muted pt-1 text-[11px]">The boss hires and archives specialists from its chat; admins can do it here.</p>
    </div>
  );
}

export function TasksTab() {
  const [data, setData] = useState<CommandCenterData | null>(null);
  const reload = (): void => { openCommandCenter().then(setData).catch(() => {}); };
  useEffect(() => {
    reload();
    const t = setInterval(reload, 6000); // live-ish status: is it still working?
    const onToolResult = (): void => reload();
    window.addEventListener('opersona:tool-result', onToolResult);
    return () => { clearInterval(t); window.removeEventListener('opersona:tool-result', onToolResult); };
  }, []);
  if (!data) return <p className="muted p-3 text-xs">loading your delegations…</p>;
  if (data.tasks.length === 0) {
    return <p className="muted p-3 text-xs">No delegated tasks yet. Ask the boss to delegate something — every assignment lands here with live status.</p>;
  }
  return (
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3" data-cc-tasks>
      {data.tasks.map((t) => (
        <Link
          key={t.slug}
          href={`/ask/${t.cloneId}/${t.slug}`}
          className="block rounded-lg bg-neutral-50 px-2 py-1.5 transition-colors hover:bg-neutral-100 dark:bg-neutral-800/50 dark:hover:bg-neutral-800"
        >
          <div className="flex items-center gap-2">
            <span className={'h-[7px] w-[7px] shrink-0 ' + (t.status === 'live' ? 'animate-pulse bg-amber-500' : t.hasResult ? 'bg-emerald-500' : 'bg-neutral-400')} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">→ {t.assignee}</span>
            <span className="muted shrink-0 text-[10px]">{ago(t.at)}</span>
          </div>
          <p className="muted mt-0.5 truncate pl-3.5 text-[11px]">
            {t.status === 'live' ? 'working…' : t.hasResult ? 'delivered' : 'no result recorded'} · {t.title}
          </p>
        </Link>
      ))}
      <p className="muted pt-1 text-[11px]">Your delegations only — amber pulse means the persona is still working.</p>
    </div>
  );
}

export function ActivityTab() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  useEffect(() => {
    const reload = (): void => { openActivity().then((d) => setEvents(d.events)).catch(() => {}); };
    reload();
    const onToolResult = (): void => reload();
    window.addEventListener('opersona:tool-result', onToolResult);
    return () => window.removeEventListener('opersona:tool-result', onToolResult);
  }, []);
  if (!events) return <p className="muted p-3 text-xs">loading the floor log…</p>;
  if (events.length === 0) return <p className="muted p-3 text-xs">Quiet so far — hires, rehires and archives land here.</p>;
  return (
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3" data-cc-activity>
      {events.map((e, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg bg-neutral-50 px-2 py-1.5 dark:bg-neutral-800/50">
          <span className={'h-[7px] w-[7px] shrink-0 ' + (e.kind === 'hired' ? 'bg-emerald-500' : e.kind === 'archived' ? 'bg-neutral-400' : 'bg-amber-500')} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs">{e.text}</span>
          <span className="muted shrink-0 text-[10px]">{ago(e.at)}</span>
        </div>
      ))}
      <p className="muted pt-1 text-[11px]">Staffing only — never anyone&apos;s conversations.</p>
    </div>
  );
}
