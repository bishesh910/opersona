'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importFromSlugAction } from '@/actions/import';

export function ImportButton({ slug }: { slug: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-1">
      <button
        type="button"
        className="btn-primary"
        disabled={pending}
        onClick={() => start(async () => {
          try {
            setErr(null);
            const r = await importFromSlugAction(slug);
            router.push(`/opersonas/${r.cloneId}/chat`);
          } catch (e) {
            setErr(e instanceof Error ? e.message.replace(/^.*Error: /, '') : 'import failed');
          }
        })}
      >
        {pending ? 'Adding…' : 'Add to my workspace'}
      </button>
      {err && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{err}</p>}
    </div>
  );
}
