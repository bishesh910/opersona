'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_RECIPE, type AvatarRecipe } from '@opersona/shared';
import { saveAvatarAction } from '@/actions/avatar';
import { AvatarCanvas } from './AvatarCanvas';
import { RecipeEditor } from './RecipeEditor';
import { SelfieUpload } from './SelfieUpload';

export function AvatarEditor({ cloneId, initial, readOnly }: { cloneId: string; initial: AvatarRecipe | null; readOnly: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'choose' | 'edit'>(initial ? 'edit' : 'choose');
  const [recipe, setRecipe] = useState<AvatarRecipe>(initial ?? DEFAULT_RECIPE);
  const [confidence, setConfidence] = useState<Record<string, number> | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();

  const lowConfidence = confidence ? Object.entries(confidence).filter(([, v]) => v < 0.6).map(([k]) => k) : [];

  function save() {
    start(async () => {
      const res = await saveAvatarAction(cloneId, recipe);
      setMsg(res.ok ? { kind: 'ok', text: 'Avatar saved.' } : { kind: 'err', text: res.error ?? 'Failed' });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="grid gap-6 md:grid-cols-[auto_1fr]">
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

      <div className="space-y-5">
        {mode === 'choose' && !readOnly ? (
          <div className="card space-y-4">
            <h2 className="font-medium">Start from a selfie, or pick by hand</h2>
            <SelfieUpload onRecipe={(r, c) => { setRecipe(r); setConfidence(c); setMode('edit'); }} />
            <div className="muted text-xs">or</div>
            <button type="button" className="btn-secondary" onClick={() => setMode('edit')}>Skip selfie, pick manually</button>
          </div>
        ) : (
          <>
            {!readOnly && (
              <div className="card space-y-2">
                <SelfieUpload onRecipe={(r, c) => { setRecipe(r); setConfidence(c); setMsg(null); }} />
                {lowConfidence.length > 0 && (
                  <p className="text-xs text-amber-600">Low confidence on: {lowConfidence.join(', ')} — worth a second look below.</p>
                )}
              </div>
            )}
            <RecipeEditor recipe={recipe} onChange={(r) => { setRecipe(r); setMsg(null); }} disabled={readOnly} />
            {!readOnly && (
              <div className="flex items-center gap-3">
                <button type="button" className="btn-primary" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save avatar'}</button>
                <button type="button" className="btn-secondary" onClick={() => { setRecipe(DEFAULT_RECIPE); setConfidence(null); }}>Reset</button>
                {msg && <span className={'text-sm ' + (msg.kind === 'ok' ? 'text-green-700 dark:text-green-400' : 'text-red-600')}>{msg.text}</span>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
