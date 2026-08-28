'use client';
import { useState } from 'react';
import { AXIS_POLES, type Axis } from '@opersona/shared';
import { saveStatedTypeAction } from '@/actions/personality';

const PAIRS: { axis: Axis; letters: [string, string] }[] = [
  { axis: 'EI', letters: ['E', 'I'] },
  { axis: 'SN', letters: ['S', 'N'] },
  { axis: 'TF', letters: ['T', 'F'] },
  { axis: 'JP', letters: ['J', 'P'] },
];

/**
 * "I already know my type" — four letter-pair toggles, one save. Stores the type
 * with direction-only sentinels (no invented strengths); shared by the
 * Personality tab and the onboarding Mind step.
 */
export function TypeEntry({ cloneId, initial, onDone }: {
  cloneId: string;
  initial?: string | null;
  onDone: (type: string) => void;
}) {
  const valid = initial && /^[EI][SN][TF][JP]$/.test(initial) ? initial : null;
  const [letters, setLetters] = useState<(string | null)[]>(valid ? valid.split('') : [null, null, null, null]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = letters.every(Boolean) ? letters.join('') : null;

  async function save() {
    if (!type) return;
    setPending(true);
    setError(null);
    try {
      const res = await saveStatedTypeAction({ cloneId, type });
      if (!res.ok) { setError(res.error ?? 'Could not save.'); return; }
      onDone(type);
    } catch {
      setError('Could not save.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {PAIRS.map(({ axis, letters: pair }, i) => (
          <div key={axis} className="grid grid-cols-2 gap-2">
            {pair.map((L, j) => {
              const selected = letters[i] === L;
              return (
                <button
                  key={L}
                  type="button"
                  aria-pressed={selected}
                  className={`${selected ? 'btn-primary' : 'btn-secondary'} btn-sm justify-start gap-2`}
                  onClick={() => setLetters((ls) => ls.map((v, k) => (k === i ? L : v)))}
                >
                  <span className="font-mono text-sm font-bold">{L}</span>
                  <span className="text-xs font-normal">{AXIS_POLES[axis][j]}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-xl font-semibold tracking-widest">{type ?? '····'}</span>
        <button type="button" className="btn-primary btn-sm" disabled={!type || pending} onClick={save}>
          {pending ? 'Saving…' : 'Save my type'}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      <p className="muted text-xs">
        Saves the four letters only — no made-up percentages. Take the test any time to
        measure how strong each lean actually is.
      </p>
    </div>
  );
}
