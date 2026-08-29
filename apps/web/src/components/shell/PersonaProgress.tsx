'use client';
/**
 * The nav's "how is my persona coming along?" surface. A small honest bar
 * (server-computed build progress), and — the part that matters for a new
 * user — clicking it opens THE GUIDE: how the persona actually gets built,
 * which since the MCP pivot means "on claude.ai, through the connector".
 * The connector step re-checks itself live so the ✓ appears while the guide
 * is still open in one tab and claude.ai in another.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { CopyButton } from '@/components/shell/CopyButton';
import { connectorState, bridgeState } from '@/actions/bridge';
import { failedExtractionCount } from '@/actions/progress';
import { progressParts, PART_MAX, type ProgressData } from '@/lib/persona-progress-math';

function StepChip({ done, n }: { done: boolean; n: number }) {
  return (
    <span className={
      'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ' +
      (done
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
        : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300')
    }>
      {done ? '✓' : n}
    </span>
  );
}

export function PersonaProgress({ data, cloneId, variant = 'sidebar' }: { data: ProgressData; cloneId?: string; variant?: 'sidebar' | 'pill' }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(data.failedExtractions);
  const [online, setOnline] = useState<boolean | null>(null);
  const [total, setTotal] = useState(data.failedExtractions);
  const [kicked, setKicked] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => { setWaiting(data.failedExtractions); setTotal((t) => Math.max(t, data.failedExtractions)); }, [data.failedExtractions]);

  // While the panel is open with a backlog: poll the count (so it drains
  // visibly) and the bridge state (processing bar when online; a retry button
  // only when nothing can drain on its own).
  useEffect(() => {
    if (!open || waiting === 0) return;
    const poll = () => {
      void failedExtractionCount().then((n) => { setWaiting(n); setTotal((t) => Math.max(t, n)); }).catch(() => {});
      void bridgeState().then((st) => setOnline(st.connected)).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
  }, [open, waiting === 0]);

  // Bridge online + backlog → kick the drain ourselves, once per panel-open.
  // (The server dedupes, so this is safe alongside the automatic hello-drain.)
  useEffect(() => {
    if (open && online === true && waiting > 0 && !kicked && cloneId) {
      setKicked(true);
      void fetch(`/api/engine/clones/${cloneId}/learning/retry-extractions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
    }
    if (!open && kicked) setKicked(false);
  }, [open, online, waiting, kicked, cloneId]);

  /** "Sync now": requeue failed extractions and report which rail will run them.
   *  (The same drain fires automatically whenever the bridge connects.) */
  async function retryNow() {
    if (!cloneId) return;
    setSyncBusy(true); setSyncMsg(null);
    try {
      const res = await fetch(`/api/engine/clones/${cloneId}/learning/retry-extractions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const r = (await res.json()) as { queued?: number; rail?: 'bridge' | 'key' | 'none'; error?: string };
      if (!res.ok) { setSyncMsg(r.error ?? 'Could not queue the retry.'); return; }
      setSyncMsg(r.rail === 'none'
        ? `Queued ${r.queued} — but no Claude is connected right now. Wake your bridge machine (or add an API key in Settings → Models); they run the moment it connects.`
        : `Queued ${r.queued} — processing on your ${r.rail === 'bridge' ? 'bridge machine' : 'API key'} now. Give it a few minutes, then check Memory.`);
    } catch {
      setSyncMsg('Could not queue the retry — try again.');
    } finally { setSyncBusy(false); }
  }
  const [connector, setConnector] = useState(data.connector);
  const [origin, setOrigin] = useState('https://opersona.me');
  useEffect(() => { if (window.location.origin.startsWith('http')) setOrigin(window.location.origin); }, []);

  // While the guide is open, watch for the connector appearing (the user is
  // likely completing that step on claude.ai in another tab right now).
  useEffect(() => {
    if (!open || connector) return;
    let stop = false;
    const poll = () => { void connectorState().then((st) => { if (!stop && st.connected) setConnector(true); }).catch(() => {}); };
    const t = setInterval(poll, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [open, connector]);

  const parts = progressParts({ connector, answered: data.answered, coveragePct: data.coveragePct, patterns: data.patterns, scored: data.scored });
  const pct = parts.pct;
  const url = `${origin}/mcp`;

  const trigger = variant === 'pill' ? (
    <button type="button" onClick={() => setOpen(true)}
      className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
      title="How your persona gets built">
      <span className="inline-block h-1.5 w-10 overflow-hidden rounded-full bg-neutral-300 dark:bg-neutral-700">
        <span className="block h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums">{pct}%</span>
    </button>
  ) : (
    <button type="button" onClick={() => setOpen(true)}
      className="w-full rounded-md px-3 py-2 text-left hover:bg-neutral-200/60 dark:hover:bg-neutral-800/60"
      title="How your persona gets built">
      <span className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">Your persona</span>
        <span className="muted tabular-nums">{pct}%</span>
      </span>
      <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-neutral-300 dark:bg-neutral-700">
        <span className="block h-full rounded-full bg-amber-400 transition-[width]" style={{ width: `${pct}%` }} />
      </span>
      <span className="muted mt-1 block text-[11px]">how it gets built →</span>
    </button>
  );

  return (
    <>
      {trigger}
      {mounted && open && createPortal(
        <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/50" role="dialog" aria-modal="true" aria-label="How your persona gets built" onClick={() => setOpen(false)}>
          <div className="flex min-h-full items-start justify-center sm:items-center sm:p-4">
          {/* phones: a full-screen sheet with its own scroll; sm+: a centered dialog */}
          <div className="card w-full space-y-4 p-4 max-sm:min-h-full max-sm:rounded-none max-sm:border-x-0 sm:my-6 sm:max-w-lg sm:p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium">How your persona gets built</h2>
                <p className="muted mt-0.5 text-sm">The building happens on <span className="font-medium text-neutral-700 dark:text-neutral-300">claude.ai</span> — this site is where the model lives and shows its receipts.</p>
              </div>
              <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setOpen(false)}>Close</button>
            </div>

            {data.failedExtractions > 0 && (
              waiting === 0 ? (
                <p className="rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                  All caught up — every waiting answer has been processed. Check <Link href="/me/memory" className="underline underline-offset-2" onClick={() => setOpen(false)}>Memory</Link> to see what it learned.
                </p>
              ) : online === false ? (
              /* Nothing can drain: the machine is asleep. This is the ONLY state with a button. */
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                <p>
                  <span className="font-medium">{waiting} interview answer{waiting === 1 ? '' : 's'} waiting</span> — your bridge machine is
                  offline. Wake it and they process automatically (or add an API key in Settings → Models). Nothing is lost.
                </p>
                {cloneId && (
                  <button type="button" className="btn-secondary btn-sm !text-xs" disabled={syncBusy} onClick={() => void retryNow()}>
                    {syncBusy ? 'Queueing…' : 'Retry now'}
                  </button>
                )}
                {syncMsg && <p>{syncMsg}</p>}
              </div>
              ) : (
              /* Bridge online (or checking): the drain runs itself — show progress, no button. */
              <div className="space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-xs dark:border-neutral-800 dark:bg-neutral-900/60">
                <p className="text-neutral-700 dark:text-neutral-300">
                  <span className="font-medium">Processing on your bridge</span> — {Math.max(0, total - waiting)} of {total} done, {waiting} to go.
                </p>
                <span className="block h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                  <span className="block h-full animate-pulse rounded-full bg-amber-400 transition-[width] duration-700" style={{ width: `${total > 0 ? Math.round(((total - waiting) / total) * 100) : 0}%` }} />
                </span>
              </div>
              )
            )}
            <ol className="space-y-3.5 text-sm">
              <li className="flex gap-2.5">
                <StepChip done={connector} n={1} />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="font-medium">Add the opersona connector on claude.ai</p>
                  <p className="muted text-xs">claude.ai → Settings → Connectors → <span className="font-medium text-neutral-700 dark:text-neutral-300">Add custom connector</span> → paste this URL, sign in, press Allow:</p>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1 font-mono text-[11px] dark:bg-neutral-800">{url}</code>
                    <CopyButton text={url} />
                  </div>
                  {connector && <p className="text-xs text-emerald-600 dark:text-emerald-400">connected to your claude.ai ✓</p>}
                </div>
              </li>
              <li className="flex gap-2.5">
                <StepChip done={data.answered > 0} n={2} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Say &ldquo;opersona me&rdquo; — get interviewed</p>
                  <p className="muted text-xs">
                    In any claude.ai chat, those two words start your cognitive interview: real moments, your real words,
                    a few minutes at a time. It&rsquo;s the fastest way to teach it who you are.
                    {data.answered > 0
                      ? <> Coverage so far: <span className="font-medium text-neutral-700 dark:text-neutral-300">{data.coveragePct}%</span> — there&rsquo;s no finish line; every session deepens it.</>
                      : <> Nothing answered yet.</>}
                  </p>
                </div>
              </li>
              <li className="flex gap-2.5">
                <StepChip done={data.patterns > 0} n={3} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Let it learn from your real work</p>
                  <p className="muted text-xs">
                    Chat on claude.ai as usual (say <em>&ldquo;learn from this chat&rdquo;</em> when one was very you),{' '}
                    <Link href="/onboarding/sources" className="underline underline-offset-2" onClick={() => setOpen(false)}>import your claude.ai / ChatGPT history</Link>,
                    and pair the bridge so finished Claude Code sessions teach it automatically. (Everything it learns
                    is processed through YOUR Claude — while your bridge machine sleeps, learning waits and catches up on wake.)
                    {data.patterns > 0 && <> Confirmed reasoning patterns so far: <span className="font-medium text-neutral-700 dark:text-neutral-300">{data.patterns}</span>.</>}
                  </p>
                </div>
              </li>
              <li className="flex gap-2.5">
                <StepChip done={data.scored > 0} n={4} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">Check the receipts, then test it blind</p>
                  <p className="muted text-xs">
                    <Link href="/me/memory" className="underline underline-offset-2" onClick={() => setOpen(false)}>Memory</Link> shows everything it learned with your words as evidence (veto anything).{' '}
                    <Link href="/me/survey" className="underline underline-offset-2" onClick={() => setOpen(false)}>Test me</Link> makes it predict you blind — and every miss you correct makes it more you.
                    {data.scored > 0 && <> Scored scenarios: <span className="font-medium text-neutral-700 dark:text-neutral-300">{data.scored}</span>.</>}
                  </p>
                </div>
              </li>
            </ol>

            <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
              <p className="muted mb-1.5 text-[11px] font-medium">Where the {pct}% comes from — a build meter, not an accuracy score:</p>
              <dl className="muted grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-[11px] tabular-nums">
                {/* one-time milestones show as ✓ +N, never as a fraction ("10/10" read as a completion score) */}
                <dt>Connector added (one-time)</dt><dd>{parts.connector ? `✓ +${PART_MAX.connector}` : `0 / ${PART_MAX.connector}`}</dd>
                <dt>First interview answer (one-time)</dt><dd>{parts.started ? `✓ +${PART_MAX.started}` : `0 / ${PART_MAX.started}`}</dd>
                <dt>Interview coverage ({data.coveragePct}% of ten areas)</dt><dd>{Math.round(parts.coverage)} / {PART_MAX.coverage}</dd>
                <dt>Thinking patterns confirmed ({data.patterns}; full credit at 3)</dt><dd>{Math.round(parts.patterns)} / {PART_MAX.patterns}</dd>
                <dt>Blind tests scored ({data.scored}; full credit at 5)</dt><dd>{Math.round(parts.scored)} / {PART_MAX.scored}</dd>
              </dl>
              <p className="muted mt-1.5 text-[11px]">
                How ACCURATE the persona is lives elsewhere: behavioural similarity from blind tests, which shows no number until 5 are scored.
                Your claude.ai conversations never stream here; only the tool calls your own Claude makes do.
              </p>
            </div>
          </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
