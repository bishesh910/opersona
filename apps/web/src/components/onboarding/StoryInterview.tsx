'use client';
/**
 * Four quick questions instead of an essay. One question on screen at a time,
 * Enter advances, your pixie does the asking — then the cheapest model drafts
 * the story and the classic form becomes "tweak the draft".
 */
import { useEffect, useRef, useState } from 'react';

export interface InterviewAnswers { role: string; knownFor?: string; style?: string; rules?: string }

const QUESTIONS: { key: keyof InterviewAnswers; q: string; hint: string; placeholder: string; optional?: boolean }[] = [
  { key: 'role', q: 'First things first — what do you do?', hint: 'job title or your own words, one line', placeholder: 'SOC engineer · indie hacker · med student…' },
  { key: 'knownFor', q: 'What do people always ping YOU for?', hint: "the thing you're weirdly good at", placeholder: 'untangling prod incidents at 2am…', optional: true },
  { key: 'style', q: 'How should answers come at you?', hint: 'your persona will copy this', placeholder: 'short & sharp / walk me through it / evidence first…', optional: true },
  { key: 'rules', q: 'Any hard rules you never break?', hint: 'your persona will refuse to break them too', placeholder: 'never deploy on a Friday…', optional: true },
];

export function StoryInterview({ onDone, onSkip, busy }: {
  onDone: (answers: InterviewAnswers) => void;
  onSkip: () => void;
  busy: boolean;
}) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<InterviewAnswers>({ role: '' });
  const [val, setVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const q = QUESTIONS[i]!;
  useEffect(() => { setVal((answers[q.key] as string) ?? ''); inputRef.current?.focus(); }, [i, q.key]); // eslint-disable-line react-hooks/exhaustive-deps

  function advance() {
    const v = val.trim();
    if (!v && !q.optional) return;
    const next = { ...answers, [q.key]: v || undefined } as InterviewAnswers;
    setAnswers(next);
    if (i < QUESTIONS.length - 1) setI(i + 1);
    else onDone(next);
  }

  return (
    <div className="card space-y-4" data-story-interview>
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {QUESTIONS.map((_, n) => (
            <span key={n} className={'h-1.5 w-6 rounded-full ' + (n < i ? 'bg-amber-400' : n === i ? 'bg-neutral-800 dark:bg-neutral-200' : 'bg-neutral-200 dark:bg-neutral-700')} />
          ))}
        </div>
        <span className="muted text-xs">{i + 1} / {QUESTIONS.length} · then I write it</span>
      </div>
      <div>
        <p className="text-lg font-medium">{q.q}</p>
        <p className="muted mt-0.5 text-xs">{q.hint}{q.optional ? ' · optional' : ''}</p>
      </div>
      <input
        ref={inputRef}
        className="input text-sm"
        value={val}
        placeholder={q.placeholder}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') advance(); }}
        maxLength={300}
        disabled={busy}
      />
      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" onClick={advance} disabled={busy || (!val.trim() && !q.optional)}>
          {busy ? 'Writing your story…' : i === QUESTIONS.length - 1 ? (val.trim() || !q.optional ? '✨ Write my story' : '✨ Write my story (skip this one)') : 'Next'}
        </button>
        {i > 0 && !busy && (
          <button type="button" className="muted text-sm underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200" onClick={() => setI(i - 1)}>back</button>
        )}
        {!busy && (
          <button type="button" className="muted ml-auto text-xs underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200" onClick={onSkip}>
            I&apos;ll write it myself
          </button>
        )}
      </div>
    </div>
  );
}
