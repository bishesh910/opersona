'use client';
/** Upload a .persona.json from any opersona instance — the federation roundtrip. */
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { importFromFileAction } from '@/actions/import';

export function ImportFileButton() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          if (f.size > 400_000) { setErr('that file is too large to be a persona export'); return; }
          start(async () => {
            try {
              setErr(null);
              const raw: unknown = JSON.parse(await f.text());
              const r = await importFromFileAction(raw);
              if (r.error) { setErr(r.error); return; }
              router.push(`/opersonas/${r.cloneId}`);
            } catch (er) {
              setErr(er instanceof SyntaxError ? 'not a JSON file' : er instanceof Error ? er.message.replace(/^.*Error: /, '') : 'import failed');
            }
          });
        }} />
      <button type="button" className="btn-secondary" disabled={pending} onClick={() => fileRef.current?.click()}
        title="Add a persona from a .persona.json file (downloaded from any opersona)">
        {pending ? 'Importing…' : 'Import file'}
      </button>
      {err && <p className="w-full text-xs text-red-600 dark:text-red-400" role="alert">{err}</p>}
    </>
  );
}
