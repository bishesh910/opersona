'use client';
import type { ActionResult } from '@/actions/brief';

export function ActionStatus({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  if (!state.ok) return <span className="text-xs text-red-600">{state.error}</span>;
  if (state.warning) return <span className="text-xs text-amber-600">{state.warning}</span>;
  return <span className="text-xs text-green-700 dark:text-green-400">Saved and snapshot rendered.</span>;
}

export function SpineChips({ status, sourceKind, confidence }: { status: string; sourceKind: string; confidence: number }) {
  return (
    <span className="inline-flex gap-1">
      <span className="chip">{status}</span>
      <span className="chip">{sourceKind}</span>
      <span className="chip">{Math.round(confidence * 100)}%</span>
    </span>
  );
}
