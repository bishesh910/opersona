/**
 * Interview-learned knowledge, read view: life memories, traits (values /
 * beliefs / preferences / behaviours / decision patterns) and IF/THEN rules.
 * Every item shows its epistemic tier in plain words and expands to the
 * verbatim quotes behind it — the receipts, always one tap away.
 * Server components (no interactivity yet — verdicts arrive with the next phase).
 */
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
      {evidence.slice(0, 4).map((e, i) => (
        <li key={i} className="muted text-xs italic">“{e.quote}”</li>
      ))}
    </ul>
  );
}

// ── memories ─────────────────────────────────────────────────────────────────
export interface MemoryRowData {
  id: string; summary: string; fullContext: string; importance: number;
  peopleInvolved: string[]; dateOrPeriod: string | null; evidence: KnowledgeEvidence[];
}

export function MemoryList({ rows }: { rows: MemoryRowData[] }) {
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

export function TraitList({ rows }: { rows: TraitRowData[] }) {
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
  tier: 'explicit' | 'inferred'; confidence: number; evidence: KnowledgeEvidence[];
}

export function RuleList({ rows }: { rows: RuleRowData[] }) {
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
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
