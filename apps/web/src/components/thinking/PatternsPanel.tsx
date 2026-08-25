'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReasoningDimension } from '@opersona/db';

export interface PatternRow {
  key: string;
  dimension: ReasoningDimension;
  description: string;
  strength: number;
  nSources: number;
  status: 'emerging' | 'confirmed' | 'rejected';
  userVerdict: 'accept' | 'reject' | null;
  examples: string[];
  lastSeenAt: string;
}

export const DIMENSION_LABEL: Record<ReasoningDimension, string> = {
  decomposition: 'How I break problems down',
  starting_point: 'Where I start',
  information: 'What I ask for and trust',
  verification: 'How I check myself',
  explanation: 'How I want things explained',
  risk: 'How I treat risk',
  pace: 'Pace and scope',
  other: 'Other',
};

const MAX_STRENGTH = 5;

/** 40px neutral strength bar used in rows and group headers. */
function MiniBar({ value }: { value: number }) {
  const pct = Math.round((Math.min(Math.max(value, 0), MAX_STRENGTH) / MAX_STRENGTH) * 100);
  return (
    <span className="block h-1 w-10 shrink-0 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700" title={`strength ${value.toFixed(2)}`}>
      <span className="block h-full rounded-full bg-neutral-400 dark:bg-neutral-500" style={{ width: `${pct}%` }} />
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span aria-hidden className={'muted inline-block w-3 shrink-0 text-[10px] leading-none transition-transform ' + (open ? 'rotate-90' : '')}>
      ▶
    </span>
  );
}

/** One pattern as a single dense line; clicking expands it inline. */
function PatternLine({ cloneId, p, readOnly, expanded, onToggle, onChanged }: {
  cloneId: string; p: PatternRow; readOnly: boolean; expanded: boolean; onToggle: () => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function verdict(v: 'accept' | 'reject' | null) {
    setBusy(true); setErr(null);
    const res = await fetch(`/api/engine/clones/${cloneId}/patterns/${encodeURIComponent(p.key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict: v }),
    });
    setBusy(false);
    if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; setErr(j.error ?? `Failed (${res.status})`); return; }
    onChanged();
  }

  return (
    <li className="border-b border-neutral-100 last:border-0 dark:border-neutral-800" data-pattern={p.key} data-status={p.status}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-2.5 py-1.5 text-left">
        <span className="min-w-0 flex-1 truncate text-sm">{p.description}</span>
        <MiniBar value={p.strength} />
        <span className="muted w-7 shrink-0 text-right text-xs tabular-nums" title={`seen in ${p.nSources} ${p.nSources === 1 ? 'chat' : 'chats'}`}>×{p.nSources}</span>
        {p.userVerdict === 'accept' && <span className="shrink-0 text-xs text-green-600 dark:text-green-500">✓ you</span>}
      </button>
      {expanded && (
        <div className="space-y-2 pb-3 pl-0.5 pt-0.5">
          <div className="muted text-xs font-medium uppercase tracking-wide">{DIMENSION_LABEL[p.dimension] ?? DIMENSION_LABEL.other}</div>
          <p className="text-sm">{p.description}</p>
          {p.examples.length > 0 && (
            <ul className="space-y-1 border-l-2 border-neutral-200 pl-3 dark:border-neutral-700">
              {p.examples.map((q, i) => (
                <li key={i} className="muted text-xs italic [overflow-wrap:anywhere]">“{q}”</li>
              ))}
            </ul>
          )}
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" className={'btn-secondary btn-sm ' + (p.userVerdict === 'accept' ? 'border-green-500' : '')} disabled={busy || p.userVerdict === 'accept'} onClick={() => verdict('accept')}>
                That’s me
              </button>
              <button type="button" className={'btn-secondary btn-sm ' + (p.userVerdict === 'reject' ? 'border-red-500' : '')} disabled={busy || p.userVerdict === 'reject'} onClick={() => verdict('reject')}>
                Not me
              </button>
              {p.userVerdict && (
                <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => verdict(null)} title="Forget your verdict and let the evidence decide">
                  Reset
                </button>
              )}
              {busy && <span className="muted text-xs">Saving…</span>}
              {err && <span className="text-xs text-red-600">{err}</span>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function PatternList({ cloneId, items, readOnly, expandedKey, setExpandedKey, onChanged }: {
  cloneId: string; items: PatternRow[]; readOnly: boolean;
  expandedKey: string | null; setExpandedKey: (k: string | null) => void; onChanged: () => void;
}) {
  return (
    <ul>
      {items.map((p) => (
        <PatternLine
          key={p.key}
          cloneId={cloneId}
          p={p}
          readOnly={readOnly}
          expanded={expandedKey === p.key}
          onToggle={() => setExpandedKey(expandedKey === p.key ? null : p.key)}
          onChanged={onChanged}
        />
      ))}
    </ul>
  );
}

/** Default-collapsed section for Emerging / Rejected. */
function CollapsedSection({ title, count, hint, muted, children }: {
  title: string; count: number; hint: string; muted?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className={muted ? 'opacity-60' : undefined}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 py-1 text-left">
        <Chevron open={open} />
        <span className="text-sm font-medium">
          {title} <span className="muted font-normal">· {count} — {hint}</span>
        </span>
      </button>
      {open && (count > 0 ? <div className="pl-5">{children}</div> : <p className="muted pl-5 text-xs">None yet.</p>)}
    </section>
  );
}

export function PatternsPanel({ cloneId, patterns, readOnly }: { cloneId: string; patterns: PatternRow[]; readOnly: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<ReasoningDimension>>(new Set());
  const confirmed = patterns.filter((p) => p.status === 'confirmed');
  const emerging = patterns.filter((p) => p.status === 'emerging');
  const rejected = patterns.filter((p) => p.status === 'rejected');
  const refresh = () => router.refresh();

  async function recompute() {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/engine/clones/${cloneId}/fingerprint/recompute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    setBusy(false);
    if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; setMsg(j.error ?? `Recompute failed (${res.status})`); return; }
    setMsg('Recomputed.');
    refresh();
  }

  async function tidy() {
    setTidying(true); setMsg(null);
    const res = await fetch(`/api/engine/clones/${cloneId}/fingerprint/tidy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    setTidying(false);
    if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { error?: string }; setMsg(j.error ?? `Tidy failed (${res.status})`); return; }
    const j = (await res.json().catch(() => ({}))) as { groups?: number; absorbed?: number };
    setMsg(j.absorbed ? `Merged ${j.absorbed} duplicate${j.absorbed === 1 ? '' : 's'} into ${j.groups ?? 0} pattern${(j.groups ?? 0) === 1 ? '' : 's'}.` : 'No duplicates found.');
    refresh();
  }

  // Confirmed grouped by dimension: strongest patterns first inside each group, groups by total strength.
  const byDim = new Map<ReasoningDimension, PatternRow[]>();
  for (const p of confirmed) {
    const list = byDim.get(p.dimension) ?? [];
    list.push(p);
    byDim.set(p.dimension, list);
  }
  const confirmedGroups = [...byDim.entries()]
    .map(([dim, items]) => ({
      dim,
      items: [...items].sort((a, b) => b.strength - a.strength),
      total: items.reduce((sum, p) => sum + p.strength, 0),
    }))
    .sort((a, b) => b.total - a.total);
  const allOpen = confirmedGroups.length > 0 && confirmedGroups.every((g) => openGroups.has(g.dim));

  function toggleGroup(dim: ReasoningDimension) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(dim)) next.delete(dim); else next.add(dim);
      return next;
    });
  }

  const listProps = { cloneId, readOnly, expandedKey, setExpandedKey, onChanged: refresh };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">How I think</h2>
          <p className="muted max-w-2xl text-sm">
            Learned from how you reason in your chats — not what you asked about. Confirmed patterns shape every answer; emerging ones wait for more evidence.
          </p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <a className="btn-secondary btn-sm" href={`/api/engine/clones/${cloneId}/export?kind=persona`} title="Everything: brief, fingerprint, facts, playbooks, avatar, prompt">Export persona</a>
            <a className="btn-secondary btn-sm" href={`/api/engine/clones/${cloneId}/export-vault`} title="Markdown vault of the whole brain — patterns with evidence, episodes, brief. Open the folder in Obsidian.">Export brain (vault)</a>
            <a className="btn-secondary btn-sm" href={`/api/engine/clones/${cloneId}/export?kind=hire`} title="An agent manifest for The Office — puts this persona on the office floor">Export for The Office</a>
          </div>
        )}
      </div>

      {patterns.length === 0 ? (
        <div className="card muted text-sm">Nothing learned yet. Have a few real conversations in Chat (or import your Claude history below) and come back.</div>
      ) : (
        <>
          <section className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h3 className="font-medium">
                Confirmed <span className="muted text-sm">({confirmed.length})</span>
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                {msg && <span className="muted text-xs">{msg}</span>}
                {confirmedGroups.length > 0 && (
                  <button
                    type="button"
                    className="muted text-xs underline-offset-2 hover:underline"
                    onClick={() => setOpenGroups(allOpen ? new Set() : new Set(confirmedGroups.map((g) => g.dim)))}
                  >
                    {allOpen ? 'Collapse all' : 'Expand all'}
                  </button>
                )}
                {!readOnly && (
                  <>
                    <button type="button" className="btn-secondary btn-sm" onClick={recompute} disabled={busy || tidying} title="Re-aggregate every observation into patterns and refresh the persona">
                      {busy ? 'Recomputing…' : 'Recompute'}
                    </button>
                    <button type="button" className="btn-secondary btn-sm" onClick={tidy} disabled={busy || tidying} title="Merge duplicate patterns that describe the same habit">
                      {tidying ? 'Tidying… ~30s' : 'Tidy up'}
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="muted text-xs">Seen in 3+ chats, or accepted by you. These shape every answer.</p>
            {confirmed.length === 0 && <p className="muted text-xs">None yet.</p>}
            <div>
              {confirmedGroups.map((g) => {
                const open = openGroups.has(g.dim);
                return (
                  <div key={g.dim}>
                    <button type="button" onClick={() => toggleGroup(g.dim)} aria-expanded={open} className="flex w-full items-center gap-2 py-1.5 text-left">
                      <Chevron open={open} />
                      <span className="text-sm font-medium">
                        {DIMENSION_LABEL[g.dim] ?? DIMENSION_LABEL.other} <span className="muted font-normal">· {g.items.length}</span>
                      </span>
                      <MiniBar value={g.total / g.items.length} />
                    </button>
                    {open && (
                      <div className="pl-5">
                        <PatternList items={g.items} {...listProps} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <CollapsedSection title="Emerging" count={emerging.length} hint="waiting for more evidence">
            <PatternList items={emerging} {...listProps} />
          </CollapsedSection>

          <CollapsedSection title="Rejected" count={rejected.length} hint="marked “not me”, never used" muted>
            <PatternList items={rejected} {...listProps} />
          </CollapsedSection>
        </>
      )}
    </div>
  );
}
