'use client';
import { useCallback, useEffect, useState } from 'react';

/** Read-only "What my persona knows": the assembled system prompt from the engine. */
export function PromptPanel({ cloneId }: { cloneId: string }) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/engine/clones/${cloneId}/prompt`, { cache: 'no-store' });
      const j = (await res.json().catch(() => ({}))) as { prompt?: string; error?: string };
      if (!res.ok) throw new Error(j.error ?? `Engine returned ${res.status}`);
      setPrompt(j.prompt ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [cloneId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <aside className="card h-fit space-y-2 lg:sticky lg:top-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">What my persona knows</h2>
        <button type="button" className="btn-secondary btn-sm" onClick={load} disabled={loading}>{loading ? '…' : 'Refresh'}</button>
      </div>
      <p className="muted text-xs">The exact system prompt assembled from your brief, facts, playbook index and lessons.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {prompt !== null && (
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-2 font-mono text-[11px] leading-snug dark:bg-neutral-950">{prompt || '(empty)'}</pre>
      )}
    </aside>
  );
}
