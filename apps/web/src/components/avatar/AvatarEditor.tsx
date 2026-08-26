'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_RECIPE, type AvatarRecipe } from '@opersona/shared';
import { randomRecipe } from '@/components/onboarding/random-recipe';
import { saveAvatarAction } from '@/actions/avatar';
import { AvatarCanvas } from './AvatarCanvas';
import { RecipeEditor } from './RecipeEditor';
import { SelfieUpload } from './SelfieUpload';

export function AvatarEditor({ cloneId, initial, readOnly }: { cloneId: string; initial: AvatarRecipe | null; readOnly: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'choose' | 'edit'>(initial ? 'edit' : 'choose');
  const [recipe, setRecipe] = useState<AvatarRecipe>(initial ?? DEFAULT_RECIPE);
  const [touched, setTouched] = useState(false);
  // fresh personas start from a random stranger, not a fixed default (post-mount to avoid hydration mismatch)
  useEffect(() => { if (!initial) setRecipe(randomRecipe()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const [confidence, setConfidence] = useState<Record<string, number> | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const lowConfidence = confidence ? Object.entries(confidence).filter(([, v]) => v < 0.6).map(([k]) => k) : [];

  function save() {
    start(async () => {
      const res = await saveAvatarAction(cloneId, recipe);
      setMsg(res.ok ? { kind: 'ok', text: 'Saved ✓' } : { kind: 'err', text: res.error ?? 'Failed' });
      if (res.ok) router.refresh();
    });
  }

  // Autosave: 1.2s after the last change (never on mount, never in choose mode).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (readOnly || mode !== 'edit') return;
    // never autosave a face the person hasn't actually chosen (random seed included)
    if (!initial && !touched) return;
    setMsg(null);
    const t = setTimeout(save, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, mode]);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[auto_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="card inline-block">
          <AvatarCanvas recipe={recipe} scale={8} title="preview" />
        </div>
        <div className="flex items-center gap-2">
          <AvatarCanvas recipe={recipe} scale={2} />
          <AvatarCanvas recipe={recipe} scale={4} />
          <span className="muted text-xs">as seen in lists / chat</span>
        </div>
      </div>

      <div className="min-w-0 space-y-5">
        {mode === 'choose' && !readOnly ? (
          <div className="card space-y-4">
            <h2 className="font-medium">Your Pixie — start from a selfie, or pick by hand</h2>
            <SelfieUpload onRecipe={(r, c) => { setTouched(true); setRecipe(r); setConfidence(c); setMode('edit'); }} />
            <div className="muted text-xs">or</div>
            <button type="button" className="btn-secondary" onClick={() => setMode('edit')}>Skip selfie, pick manually</button>
          </div>
        ) : (
          <>
            {!readOnly && (
              <div className="card space-y-2">
                <SelfieUpload onRecipe={(r, c) => { setTouched(true); setRecipe(r); setConfidence(c); setMsg(null); }} />
                {lowConfidence.length > 0 && (
                  <p className="text-xs text-amber-600">Low confidence on: {lowConfidence.join(', ')} — worth a second look below.</p>
                )}
              </div>
            )}
            <RecipeEditor recipe={recipe} onChange={(r) => { setTouched(true); setRecipe(r); setMsg(null); }} disabled={readOnly} />
            {!readOnly && (
              <div className="flex items-center gap-3">
                <button type="button" className="btn-secondary" onClick={() => { setTouched(true); setRecipe(randomRecipe()); setConfidence(null); }}>Reroll</button>
                <span className={'text-sm ' + (pending ? 'muted' : msg?.kind === 'err' ? 'text-red-600' : 'text-green-700 dark:text-green-400')} aria-live="polite">
                  {pending ? 'Saving…' : msg ? msg.text : 'Changes save automatically'}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
