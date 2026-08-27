'use client';
import { useMemo, useState } from 'react';
import { MBTI_ITEMS, LIKERT, scoreMbti, type MbtiItem, type MbtiResult } from '@opersona/shared';
import { savePersonalityAction } from '@/actions/personality';

const STEP_SIZE = 6;


/**
 * The paginated 24-item Likert test. Saves via savePersonalityAction (server-side
 * scoring) and hands the result to the caller. Shared by the personality tab and
 * the onboarding character builder — one implementation, two homes.
 */
export function MbtiTest({ cloneId, onDone, items = MBTI_ITEMS }: { cloneId: string; onDone: (result: MbtiResult, warning: string | null) => void; items?: MbtiItem[] }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const STEPS = Math.ceil(items.length / STEP_SIZE);
  const stepItems = useMemo(() => items.slice(step * STEP_SIZE, (step + 1) * STEP_SIZE), [step, items]);
  const stepDone = stepItems.every((it) => answers[it.id] != null);
  const allDone = items.every((it) => answers[it.id] != null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await savePersonalityAction({ cloneId, answers });
      if (!res.ok) {
        setError(res.error ?? 'Could not save the test.');
        return;
      }
      onDone(res.result ?? scoreMbti(answers), res.warning ?? null);
    } catch {
      setError('Could not save the test.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="muted text-xs">step {step + 1} of {STEPS}</p>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {stepItems.map((item) => (
          <div key={item.id} className="space-y-1.5 py-2.5">
            <p className="text-sm">{item.text}</p>
            <div className="flex items-center gap-2.5">
              <span className="muted w-28 shrink-0 text-right text-[11px]">{LIKERT[0]}</span>
              {LIKERT.map((label, i) => (
                <label key={i} title={label} className="inline-flex cursor-pointer items-center p-0.5">
                  <input
                    type="radio"
                    name={item.id}
                    value={i + 1}
                    checked={answers[item.id] === i + 1}
                    onChange={() => setAnswers((a) => ({ ...a, [item.id]: i + 1 }))}
                    className="h-4 w-4 accent-neutral-800 dark:accent-neutral-200"
                  />
                </label>
              ))}
              <span className="muted w-28 shrink-0 text-[11px]">{LIKERT[4]}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary btn-sm" disabled={step === 0 || pending} onClick={() => setStep((s) => s - 1)}>
          Back
        </button>
        {step < STEPS - 1 ? (
          <button type="button" className="btn-primary btn-sm" disabled={!stepDone} onClick={() => setStep((s) => s + 1)}>
            Next
          </button>
        ) : (
          <button type="button" className="btn-primary btn-sm" disabled={!allDone || pending} onClick={submit}>
            {pending ? 'Saving…' : 'See my result'}
          </button>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
