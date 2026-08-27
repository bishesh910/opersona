'use client';
/**
 * "Connect your Claude — free" card: how a subscription user (free/pro claude.ai)
 * wires their persona into claude.ai via the MCP connector. No API key involved;
 * the thinking runs on their existing Claude plan.
 */
import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/shell/CopyButton';
import { connectorState } from '@/actions/bridge';

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function ConnectorCard({ compact = false }: { compact?: boolean }) {
  const [origin, setOrigin] = useState('https://opersona.me');
  const [state, setState] = useState<{ connected: boolean; lastUsedAt: string | null } | null>(null);
  useEffect(() => { if (window.location.origin.startsWith('http')) setOrigin(window.location.origin); }, []);
  useEffect(() => {
    let stop = false;
    const poll = () => { void connectorState().then((st) => { if (!stop) setState(st); }).catch(() => {}); };
    poll();
    const t = setInterval(poll, 15000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  const url = `${origin}/mcp`;
  return (
    <div className={compact ? 'space-y-3' : 'card space-y-3'} data-connector-card>
      {!compact && (
        <div>
          <h2 className="font-medium">Use it inside claude.ai <span className="chip ml-2 border-green-400 text-green-700 dark:border-green-700 dark:text-green-400">free</span></h2>
          <p className="muted mt-1 text-sm">Add opersona as a connector and your persona lives inside your normal Claude — loading it, searching its memory, teaching it — on the Claude plan you already have. No API key.</p>
        </div>
      )}
      <div className="flex items-center gap-2 text-sm" data-connector-status>
        <span className={'inline-block h-2 w-2 rounded-full ' + (state?.connected ? 'bg-green-500' : 'bg-neutral-400')} />
        {state == null ? 'checking…' : state.connected
          ? <>connected to your claude.ai{state.lastUsedAt ? <span className="muted"> · last call {ago(state.lastUsedAt)}</span> : <span className="muted"> · no calls yet — try &ldquo;list my opersona roster&rdquo; in a chat</span>}</>
          : <>not connected yet{' '}<span className="muted">— if claude.ai already lists opersona, remove &amp; re-add it (a reset here breaks old credentials)</span></>}
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1.5 font-mono text-xs dark:bg-neutral-800" data-connector-url>{url}</code>
        <CopyButton text={url} />
      </div>
      <ol className="muted list-inside list-decimal space-y-1 text-xs">
        <li>In claude.ai: <span className="font-medium text-neutral-700 dark:text-neutral-300">Settings → Connectors → Add custom connector</span></li>
        <li>Paste the URL above, then sign in and press <span className="font-medium text-neutral-700 dark:text-neutral-300">Allow</span></li>
        <li>In any chat: <em>“load my persona and answer as me”</em></li>
      </ol>
    </div>
  );
}
