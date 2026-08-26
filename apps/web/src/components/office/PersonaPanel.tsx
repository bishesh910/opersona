'use client';
/**
 * PersonaPanel — the right sidebar (munder-difflin AgentDetailPanel, opersona
 * edition). Shows ONLY org-visible identity for the selected colleague: role,
 * team, accuracy, and confirmed thinking-pattern descriptions — exactly the
 * colleague view of /clones/[id]/thinking. No content, no live activity.
 */
import Link from 'next/link';
import type { AvatarRecipe } from '@opersona/shared';
import { askPersonaAction } from '@/actions/conversations';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';

export interface PanelMember {
  id: string | null;          // cloneId (null → no persona yet)
  key: string;                // stable select key
  name: string;
  owner: string;
  mine: boolean;
  boss: boolean;
  recipe: AvatarRecipe | null;
  role: string;
  team: string;
  accuracyPct: number | null;
  patterns: { dimension: string; description: string }[];
}

const DIM_LABEL: Record<string, string> = {
  decomposition: 'Breaking problems down', verification: 'Checking their work',
  approach: 'How they approach', analogy: 'Analogies & framing', priority: 'What they weigh first',
  tooling: 'Tools & methods', communication: 'How they explain', risk: 'Risk posture',
};

export function PersonaPanel({ member, total, onClose }: { member: PanelMember | null; total: number; onClose: () => void }) {
  if (!member) {
    return (
      <section className="card flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium">The office</p>
        <p className="muted max-w-52 text-xs">
          {total} {total === 1 ? 'colleague' : 'colleagues'} on the floor. Click a Pixie — or a roster
          card below — to see their persona here.
        </p>
        <p className="muted max-w-56 text-[11px]">
          Everything on the floor is ambient animation, never anyone&apos;s real activity.
        </p>
      </section>
    );
  }
  const byDim = new Map<string, string[]>();
  for (const p of member.patterns) { const a = byDim.get(p.dimension) ?? []; a.push(p.description); byDim.set(p.dimension, a); }

  return (
    <section className="card flex h-full flex-col overflow-hidden" data-persona-panel>
      <div className="flex items-start gap-3 border-b border-neutral-100 pb-3 dark:border-neutral-800">
        <AvatarThumb recipe={member.recipe} name={member.name} scale={2} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-sm font-semibold">{member.name}</h2>
            {member.boss && <span className="chip shrink-0">owner</span>}
            {member.mine && <span className="chip shrink-0">you</span>}
          </div>
          <p className="muted truncate text-xs">
            {[member.role, member.team].filter(Boolean).join(' · ') || (member.id ? (member.owner !== member.name ? member.owner : 'persona') : 'no persona yet')}
          </p>
          {member.accuracyPct !== null && (
            <p className="muted mt-0.5 text-[11px]">sounds-like-them accuracy: <span className="font-medium text-neutral-700 dark:text-neutral-300">{member.accuracyPct}%</span></p>
          )}
        </div>
        <button type="button" className="muted -mr-1 -mt-1 rounded p-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
        {!member.id ? (
          <p className="muted text-xs">They&apos;ve joined the org but haven&apos;t built their Pixie yet — their spot on the floor is the grey silhouette.</p>
        ) : byDim.size === 0 ? (
          <p className="muted text-xs">Nothing confirmed yet — this persona is still learning how {member.mine ? 'you' : 'they'} think.</p>
        ) : (
          [...byDim.entries()].map(([dim, descs]) => (
            <div key={dim}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">{DIM_LABEL[dim] ?? dim}</h3>
              <ul className="mt-1 space-y-1">
                {descs.map((d, i) => (
                  <li key={i} className="rounded-lg bg-neutral-50 px-2.5 py-1.5 text-xs leading-relaxed dark:bg-neutral-800/60">{d}</li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      {member.id && (
        <div className="flex gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <Link className="btn-secondary btn-sm flex-1 text-center" href={`/clones/${member.id}`}>Full persona</Link>
          {member.mine ? (
            <Link className="btn-primary btn-sm flex-1 text-center" href="/chat?mode=clone">Test yours</Link>
          ) : (
            <form action={askPersonaAction} className="flex-1">
              <input type="hidden" name="cloneId" value={member.id} />
              <button type="submit" className="btn-primary btn-sm w-full">Ask {member.name.split(' ')[0]}</button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
