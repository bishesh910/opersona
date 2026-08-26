'use client';
/**
 * PersonaPanel — the right sidebar (munder-difflin AgentDetailPanel, opersona
 * edition). Two tabs, like the original's sidebar:
 *   Chat  — talk to this persona right here (the real ChatView, embedded)
 *   About — org-visible identity: role/team, accuracy, confirmed thinking
 *           patterns (exactly the colleague view of /clones/[id]/thinking)
 * No content of other people's chats, no live activity — ever.
 */
import { useState } from 'react';
import Link from 'next/link';
import type { AvatarRecipe } from '@opersona/shared';
import { AvatarThumb } from '@/components/avatar/AvatarThumb';
import { OfficeChat } from './OfficeChat';

export interface PanelMember {
  id: string | null;          // cloneId (null → no persona yet)
  key: string;                // stable select key
  name: string;
  owner: string;
  mine: boolean;
  boss: boolean;
  hired: boolean;
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
  const [tab, setTab] = useState<'chat' | 'about'>('chat');
  if (!member) {
    return (
      <section className="card flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium">The office</p>
        <p className="muted max-w-52 text-xs">
          {total} {total === 1 ? 'colleague' : 'colleagues'} on the floor. Click a Pixie — or a roster
          card below — to talk to their persona right here.
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
    <section className="card flex h-full flex-col overflow-hidden !p-0" data-persona-panel>
      <div className="flex items-start gap-3 px-3 pb-2.5 pt-3">
        <AvatarThumb recipe={member.recipe} name={member.name} scale={2} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-sm font-semibold">{member.name}</h2>
            {member.boss && <span className="chip shrink-0">★ boss</span>}
            {member.hired && <span className="chip shrink-0">hired</span>}
            {member.mine && <span className="chip shrink-0">you</span>}
          </div>
          <p className="muted truncate text-xs">
            {[member.role, member.team].filter(Boolean).join(' · ') || (member.id ? (member.owner !== member.name ? member.owner : 'persona') : 'no persona yet')}
          </p>
        </div>
        {member.id && <Link href={`/clones/${member.id}`} className="muted mt-0.5 shrink-0 text-[11px] hover:underline">full persona →</Link>}
        <button type="button" className="muted -mr-1 -mt-1 rounded p-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={onClose} aria-label="Close">✕</button>
      </div>

      {member.id ? (
        <>
          <div role="tablist" aria-label="Persona panel" className="flex gap-1 border-b border-neutral-100 px-3 dark:border-neutral-800">
            {(['chat', 'about'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={'-mb-px border-b-2 px-2 pb-1.5 pt-0.5 text-xs font-medium transition-colors '
                  + (tab === t
                    ? 'border-amber-500 text-neutral-900 dark:text-neutral-100'
                    : 'border-transparent text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300')}
              >
                {t === 'chat' ? (member.mine ? 'Test chat' : 'Chat') : 'About'}
              </button>
            ))}
          </div>
          {tab === 'chat' ? (
            <OfficeChat cloneId={member.id} avatar={member.recipe} />
          ) : (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {member.accuracyPct !== null && (
                <p className="muted text-xs">sounds-like-them accuracy: <span className="font-medium text-neutral-700 dark:text-neutral-300">{member.accuracyPct}%</span></p>
              )}
              {byDim.size === 0 ? (
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
          )}
        </>
      ) : (
        <p className="muted p-3 text-xs">They&apos;ve joined the org but haven&apos;t built their Pixie yet — their spot on the floor is the grey silhouette.</p>
      )}
    </section>
  );
}
