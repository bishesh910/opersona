'use client';
/**
 * The per-OS pairing instructions — ONE component, shown wherever a fresh
 * bridge token is displayed (nav bridge panel + Settings), so the commands
 * can never drift between surfaces. Auto-detects the visitor's platform;
 * Linux adds the enable-linger step servers need; Windows gets the honest
 * foreground-only story (no background service there yet).
 */
import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/shell/CopyButton';

export function PairCommands({ token }: { token: string }) {
  const [os, setOs] = useState<'mac' | 'linux' | 'win'>('mac');
  useEffect(() => {
    const ua = navigator.userAgent;
    setOs(/Windows/i.test(ua) ? 'win' : /Mac/i.test(ua) ? 'mac' : 'linux');
  }, []);
  const cmd = `npx opersona@latest install --token ${token}`;
  const fgCmd = `npx opersona@latest --token ${token}`;
  const Row = ({ text }: { text: string }) => (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] dark:bg-neutral-900">{text}</code>
      <CopyButton text={text} />
    </div>
  );
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        {([['mac', 'macOS'], ['linux', 'Linux'], ['win', 'Windows']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setOs(k)}
            className={'rounded px-2 py-0.5 text-[11px] font-medium ' + (os === k
              ? 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100'
              : 'text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/50')}>
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs font-medium">
        {os === 'win'
          ? 'Run this in a terminal where Claude Code is signed in (keep the window open):'
          : 'Run this once on a machine where Claude Code is signed in — it’s the whole setup:'}
      </p>
      <Row text={os === 'win' ? fgCmd : cmd} />
      {os === 'linux' && (
        <>
          <p className="text-xs font-medium">Server or headless box? Also run this once, so it survives logout:</p>
          <Row text="loginctl enable-linger $USER" />
        </>
      )}
      <p className="muted text-xs">
        {os === 'win'
          ? 'The background service isn’t wired for Windows yet — the bridge runs while this terminal stays open. Needs Node and the claude CLI.'
          : 'Pairs, installs itself as an invisible background service, and starts it — the status dot turns ● green within seconds of it connecting. Needs Node and the claude CLI. Remove any time with npx opersona uninstall.'}
      </p>
      {os !== 'win' && (
        <p className="muted text-xs">Prefer to watch it run first? Foreground, with logs: <code className="break-all">{fgCmd}</code> <CopyButton text={fgCmd} /></p>
      )}
    </div>
  );
}
