'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteEpisodeAction } from '@/actions/memory';
import { ConfirmDialog } from '@/components/shell/Dialog';

export interface EpisodeRow { id: string; title: string; problem: string; outcome: string; date: string }

export function EpisodeList({ cloneId, episodes, readOnly }: { cloneId: string; episodes: EpisodeRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [del, setDel] = useState<EpisodeRow | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <ul className="mt-3 space-y-2">
        {episodes.map((e) => (
          <li key={e.id} className="card group py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{e.title}</span>
              <span className={'chip shrink-0 ' + (e.outcome === 'resolved' ? 'border-green-500 text-green-700 dark:text-green-400' : e.outcome === 'partial' ? 'border-amber-400 text-amber-700 dark:text-amber-400' : '')}>{e.outcome}</span>
              <span className="muted shrink-0 text-xs">{e.date}</span>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Forget "${e.title}"`}
                  title="Forget this episode"
                  className="shrink-0 rounded px-1 text-neutral-400 opacity-0 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                  onClick={() => setDel(e)}
                >✕</button>
              )}
            </div>
            {e.problem && <p className="muted mt-1 text-xs">{e.problem}</p>}
          </li>
        ))}
      </ul>
      {del && (
        <ConfirmDialog
          title="Forget this episode?"
          message={`"${del.title}" will be removed from your persona's memory. The chat itself is untouched.`}
          confirmLabel="Forget"
          busy={busy}
          onCancel={() => setDel(null)}
          onConfirm={async () => { setBusy(true); await deleteEpisodeAction(cloneId, del.id); setBusy(false); setDel(null); router.refresh(); }}
        />
      )}
    </>
  );
}
