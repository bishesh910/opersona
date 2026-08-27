'use client';
import { CopyButton } from '@/components/shell/CopyButton';

/** A monospace command with a copy button — used on the download/about pages. */
export function CopyPill({ text }: { text: string }) {
  return (
    <span className="inline-flex w-full items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded bg-neutral-100 px-2 py-1.5 font-mono text-[12px] dark:bg-neutral-800">{text}</code>
      <CopyButton text={text} />
    </span>
  );
}
