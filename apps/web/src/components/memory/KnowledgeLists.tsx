'use client';
/**
 * Interview-learned knowledge: life memories, traits (values / beliefs /
 * preferences / behaviours / decision patterns) and IF/THEN rules.
 * Every item shows its epistemic tier in plain words, expands to the verbatim
 * quotes behind it (each linking to the exact interview answer), and takes an
 * owner verdict — "That's me" confirms, "Not me" disputes, tap again to reset.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TIER_LABEL, type EpistemicTier, type TraitKind } from '@opersona/shared';

export interface KnowledgeEvidence { quote: string; ref?: string }

const TIER_CHIP: Record<EpistemicTier, string> = {
  explicit: 'chip border-emerald-400 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400',
  inferred: 'chip',
  hypothesis: 'chip border-dashed text-neutral-500',
};

function TierChip({ tier }: { tier: EpistemicTier }) {
  return <span className={TIER_CHIP[tier]}>{TIER_LABEL[tier]}</span>;
}

function ConfidenceBar({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`confidence ${Math.round(value * 100)}%`}>
      <span className="inline-block h-1.5 w-10 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <span className="block h-full rounded-full bg-amber-400" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="muted text-[11px] tabular-nums">{Math.round(value * 100)}%</span>
    </span>
  );
}

function Quotes({ evidence }: { evidence: KnowledgeEvidence[] }) {
  if (!evidence.length) return null;
  return (
    <ul className="mt-2 space-y-1 border-l-2 border-neutral-200 pl-3 dark:border-neutral-800">
      {evidence.slice(0, 4).map((e, i) => {
        const answerId = e.ref?.startsWith('interview:') ? e.ref.slice('interview:'.length) : null;
        const quote = <>“{e.quote}”</>;
        return (
          <li key={i} className="muted text-xs italic">
            {answerId
              ? <a className="hover:underline" href={`/me/interview?answer=${answerId}#a-${answerId}`} title="see the answer this came from">{quote}</a>
              : quote}
          </li>
        );
      })}
    </ul>
  );
}

/** That's me / Not me — same semantics as pattern verdicts: tap the active one to reset. */
function VerdictButtons({ cloneId, kind, itemId, status }: { cloneId: string; kind: 'trait' | 'memory' | 'rule'; itemId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function send(verdict: 'confirm' | 'dispute' | null) {
    setBusy(true);
    try {
      await fetch(`/api/engine/clones/${cloneId}/knowledge/${kind}/${itemId}/verdict`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict }),
      });
      router.refresh();
    } finally { setBusy(false); }
  }
  const confirmed = status === 'confirmed';
  const disputed = status === 'disputed';
  return (
    <span className="flex shrink-0 items-center gap-1">
      <button type="button" disabled={busy} title="That's me"
        onClick={() => void send(confirmed ? null : 'confirm')}
        className={'rounded px-1.5 py-0.5 text-xs ' + (confirmed ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300' : 'text-neutral-400 hover:text-emerald-600')}>
        ✓ me
      </button>
      <button type="button" disabled={busy} title="Not me"
        onClick={() => void send(disputed ? null : 'dispute')}
        className={'rounded px-1.5 py-0.5 text-xs ' + (disputed ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'text-neutral-400 hover:text-red-600')}>
        ✗ not me
      </button>
    </span>
  );
}

// ── memories ─────────────────────────────────────────────────────────────────
export interface MemoryRowData {
  id: string; summary: string; fullContext: string; importance: number;
  peopleInvolved: string[]; dateOrPeriod: string | null; status: string; evidence: KnowledgeEvidence[];
}

export function MemoryList({ cloneId, rows, readOnly }: { cloneId: string; rows: MemoryRowData[]; readOnly?: boolean }) {
  if (!rows.length) return <p className="muted text-sm">Nothing here yet — the Interview tab fills this in.</p>;
  return (
    <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
      {rows.map((m) => (
        <li key={m.id}>
          <details className="group px-4 py-2.5">
            <summary className="flex cursor-pointer list-none items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm">{m.summary}</span>
              {m.dateOrPeriod && <span className="muted shrink-0 text-xs">{m.dateOrPeriod}</span>}
              <span aria-hidden className="muted inline-block transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="pb-1 pt-2">
              {m.fullContext && <p className="text-sm text-neutral-700 dark:text-neutral-300">{m.fullContext}</p>}
              {m.peopleInvolved.length > 0 && <p className="muted mt-1 text-xs">with {m.peopleInvolved.join(', ')}</p>}
              <Quotes evidence={m.evidence} />
              {!readOnly && <div className="mt-2"><VerdictButtons cloneId={cloneId} kind="memory" itemId={m.id} status={m.status} /></div>}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

// ── traits ───────────────────────────────────────────────────────────────────
export interface TraitRowData {
  id: string; kind: TraitKind; label: string; statement: string; tier: EpistemicTier;
  confidence: number; status: string; reinforceCount: number; evidence: KnowledgeEvidence[];
}

const KIND_LABEL: Record<TraitKind, string> = {
  value: 'values', belief: 'beliefs', preference: 'preferences', behaviour: 'behaviours', decision_pattern: 'decision patterns',
};
const KIND_ORDER: TraitKind[] = ['value', 'belief', 'preference', 'behaviour', 'decision_pattern'];

export function TraitList({ cloneId, rows, readOnly }: { cloneId: string; rows: TraitRowData[]; readOnly?: boolean }) {
  if (!rows.length) return <p className="muted text-sm">Nothing here yet — the Interview tab fills this in.</p>;
  const groups = KIND_ORDER.map((k) => ({ kind: k, items: rows.filter((r) => r.kind === k) })).filter((g) => g.items.length);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.kind}>
          <h4 className="muted mb-1.5 text-xs font-medium uppercase tracking-wide">{KIND_LABEL[g.kind]}</h4>
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
            {g.items.map((t) => (
              <li key={t.id}>
                <details className="group px-4 py-2.5">
                  <summary className="flex cursor-pointer list-none items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.label}</span>
                    <TierChip tier={t.tier} />
                    <ConfidenceBar value={t.confidence} />
                    <span aria-hidden className="muted inline-block transition-transform group-open:rotate-90">›</span>
                  </summary>
                  <div className="pb-1 pt-2">
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">{t.statement}</p>
                    {t.reinforceCount > 0 && <p className="muted mt-1 text-xs">seen in {t.reinforceCount + 1} answers</p>}
                    <Quotes evidence={t.evidence} />
                    {!readOnly && <div className="mt-2"><VerdictButtons cloneId={cloneId} kind="trait" itemId={t.id} status={t.status} /></div>}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ── contextual rules ─────────────────────────────────────────────────────────
export interface RuleRowData {
  id: string; situation: string; condition: string | null; tendency: string;
  tier: 'explicit' | 'inferred'; confidence: number; status: string; evidence: KnowledgeEvidence[];
}

export function RuleList({ cloneId, rows, readOnly }: { cloneId: string; rows: RuleRowData[]; readOnly?: boolean }) {
  if (!rows.length) return <p className="muted text-sm">Nothing here yet — rules appear when your answers show behaviour that depends on the situation.</p>;
  return (
    <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
      {rows.map((r) => (
        <li key={r.id}>
          <details className="group px-4 py-2.5">
            <summary className="flex cursor-pointer list-none items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="muted">When</span> {r.situation}
                {r.condition && <> <span className="muted">and</span> {r.condition}</>}
                {' '}<span className="muted">—</span> {r.tendency}
              </span>
              <TierChip tier={r.tier} />
              <span aria-hidden className="muted inline-block transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="pb-1 pt-2">
              <ConfidenceBar value={r.confidence} />
              <Quotes evidence={r.evidence} />
              {!readOnly && <div className="mt-2"><VerdictButtons cloneId={cloneId} kind="rule" itemId={r.id} status={r.status} /></div>}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
