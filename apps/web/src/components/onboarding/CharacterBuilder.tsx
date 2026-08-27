'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useActionState } from 'react';
import { DEFAULT_RECIPE, type AvatarRecipe, type MbtiResult } from '@opersona/shared';
import { finishOnboardingAction } from '@/actions/onboarding';
import { saveAvatarAction } from '@/actions/avatar';
import { saveBriefAction, composeBriefAction, type ActionResult } from '@/actions/brief';
import { StoryInterview, type InterviewAnswers } from './StoryInterview';
import { AvatarCanvas } from '@/components/avatar/AvatarCanvas';
import { RecipeEditor } from '@/components/avatar/RecipeEditor';
import { SelfieUpload } from '@/components/avatar/SelfieUpload';
import { MbtiTest } from '@/components/brief/MbtiTest';
import { ApiKeyForm } from '@/components/settings/ApiKeyForm';
import { ConnectorCard } from '@/components/settings/ConnectorCard';
import { BridgeCard } from '@/components/settings/BridgeCard';
import { randomRecipe } from './random-recipe';

const STEPS = [
  { n: 1, label: 'Connect' },
  { n: 2, label: 'Pixie' },
  { n: 3, label: 'Story' },
  { n: 4, label: 'Mind' },
  { n: 5, label: 'Ready' },
] as const;

export interface BuilderBrief { displayName: string; roleTitle: string; team: string; briefMd: string; operatingRules: string }

export interface CharacterBuilderProps {
  initialStep: number;
  userName: string;
  error: string | null;
  clone: { id: string; recipe: AvatarRecipe | null };
  brief: BuilderBrief | null;
  personalityType: string | null;
  hasApiKey: boolean;
  /** Some Claude rail (bridge / key) is connected — selfie extraction can run. */
  hasRail: boolean;
}

function StepDots({ current, onGo }: { current: number; onGo: (n: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center justify-center gap-x-1 gap-y-2">
      {STEPS.map((s, i) => {
        const state = s.n < current ? 'done' : s.n === current ? 'current' : 'todo';
        const clickable = s.n < current; // walking back is always allowed
        const dot = (
          <>
            <span
              className={
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ' +
                (state === 'current'
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : state === 'done'
                    ? 'bg-neutral-300 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200'
                    : 'border border-neutral-300 text-neutral-400 dark:border-neutral-700 dark:text-neutral-500')
              }
            >
              {state === 'done' ? '✓' : s.n}
            </span>
            <span className={'text-xs ' + (state === 'current' ? 'font-semibold' : 'muted')}>{s.label}</span>
          </>
        );
        return (
          <li key={s.n} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className="mx-1 h-px w-5 bg-neutral-300 dark:bg-neutral-700 sm:w-8" />}
            {clickable ? (
              <button type="button" className="flex items-center gap-1 rounded transition-opacity hover:opacity-70" onClick={() => onGo(s.n)} title={`Back to ${s.label}`}>
                {dot}
              </button>
            ) : (
              <span className="flex items-center gap-1">{dot}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** First-run character builder: Connect → Pixie → Story → Mind → Ready.
 *  Connecting first (bridge / connector / key) unlocks selfie extraction and chat
 *  for everything after; the personal workspace already exists from signup. */
export function CharacterBuilder(props: CharacterBuilderProps) {
  const [step, setStepState] = useState(props.initialStep);
  const [recipe, setRecipe] = useState<AvatarRecipe>(props.clone?.recipe ?? DEFAULT_RECIPE);
  // new joiners meet a random stranger, not a fixed default (post-mount: SSR-safe)
  useEffect(() => { if (!props.clone?.recipe) setRecipe(randomRecipe()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const [displayName, setDisplayName] = useState(props.brief?.displayName ?? props.userName);
  const [roleTitle, setRoleTitle] = useState(props.brief?.roleTitle ?? '');
  const [mbtiType, setMbtiType] = useState<string | null>(props.personalityType);
  const [talking, setTalking] = useState(false);
  const router = useRouter();
  // The server's hasRail is a snapshot from page load; pairing happens mid-flow,
  // so watch the bridge live until a rail appears (then stop polling).
  const [railLive, setRailLive] = useState(false);
  useEffect(() => {
    if (props.hasRail || railLive) return;
    let stop = false;
    const poll = () => { void import('@/actions/bridge').then(({ bridgeState }) => bridgeState()).then((st) => { if (!stop && st.connected) setRailLive(true); }).catch(() => {}); };
    poll();
    const t = setInterval(poll, 8000);
    return () => { stop = true; clearInterval(t); };
  }, [props.hasRail, railLive]);
  const hasRail = props.hasRail || railLive;

  // A little hello on the final step.
  useEffect(() => {
    if (step !== 5) return;
    setTalking(true);
    const t = setTimeout(() => setTalking(false), 3200);
    return () => { clearTimeout(t); setTalking(false); };
  }, [step]);

  function go(n: number) {
    setStepState(n);
    // Keep ?step= in the URL so a refresh resumes here (the server honours it).
    window.history.replaceState(null, '', `/onboarding?step=${n}`);
    window.scrollTo({ top: 0 });
  }

  const heading =
    step === 1 ? 'Connect your Claude' :
    step === 2 ? 'Build your Pixie' :
    step === 3 ? 'Your story' :
    step === 4 ? 'Your mind' :
    'Your persona is ready';

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-8 dark:bg-neutral-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6">
        <div className="text-center">
          <p className="muted text-xs uppercase tracking-widest">opersona.me</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Build your persona</h1>
        </div>
        <StepDots current={step} onGo={go} />
        <h2 className="text-lg font-medium">{heading}</h2>

        <div className="flex w-full flex-col items-center gap-6 md:flex-row md:items-start md:justify-center">
          <aside className="shrink-0 space-y-2 text-center">
            <div className="card inline-block">
              <AvatarCanvas recipe={recipe} scale={8} title="your persona" talking={talking} />
            </div>
            <div className="text-sm font-medium">{displayName}</div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {roleTitle && <span className="chip">{roleTitle}</span>}
              {mbtiType && <span className="chip font-mono">{mbtiType}</span>}
            </div>
          </aside>
          <section className="w-full min-w-0 md:max-w-xl">
            {step === 1 && (
              <ConnectStep hasApiKey={props.hasApiKey} hasRail={hasRail} onNext={() => { go(2); router.refresh(); }} />
            )}
            {step === 2 && (
              <FaceStep cloneId={props.clone.id} recipe={recipe} onRecipe={setRecipe} onNext={() => go(3)} hasRail={hasRail} />
            )}
            {step === 3 && (
              <StoryStep
                cloneId={props.clone.id}
                initial={props.brief ?? { displayName: props.userName, roleTitle: '', team: '', briefMd: '', operatingRules: '' }}
                onName={setDisplayName}
                onRole={setRoleTitle}
                onNext={() => go(4)}
              />
            )}
            {step === 4 && (
              <MindStep cloneId={props.clone.id} existingType={mbtiType} onType={setMbtiType} onNext={() => go(5)} />
            )}
            {step === 5 && (
              <ReadyStep displayName={displayName} roleTitle={roleTitle} mbtiType={mbtiType} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ── Step 4: Connect ──────────────────────────────────────────────────────── */

function ConnectStep({ hasApiKey, hasRail, onNext }: { hasApiKey: boolean; hasRail: boolean; onNext: () => void }) {
  const [saved, setSaved] = useState(hasApiKey);
  const [showKey, setShowKey] = useState(hasApiKey);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  useEffect(() => {
    let stop = false;
    const poll = () => { void import('@/actions/bridge').then(({ bridgeState }) => bridgeState()).then((st) => { if (!stop) setBridgeOnline(st.connected); }).catch(() => {}); };
    poll();
    const t = setInterval(poll, 5000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  const unlocked = bridgeOnline || saved || hasRail;
  return (
    <div className="space-y-4">
      <p className="muted max-w-xl text-sm">
        Your persona thinks with <span className="font-medium text-neutral-700 dark:text-neutral-300">your own Claude</span>.
        Connect it first and every door after this opens: selfie&nbsp;→&nbsp;Pixie, chatting, and a persona that learns from your real work.
      </p>
      <BridgeCard />
      {bridgeOnline && (
        <p className="rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300" data-bridge-live>
          ● Your bridge is online — this machine now powers your persona. Onwards!
        </p>
      )}
      <div className="card space-y-3">
        <p className="text-sm">
          <span className="font-medium">Also nice:</span>{' '}
          <span className="muted">add opersona to claude.ai as a connector — your persona inside your normal Claude.</span>
        </p>
        <ConnectorCard compact />
      </div>
      <div className="card space-y-3">
        <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setShowKey((v) => !v)}>
          <span className="text-sm font-medium">Prefer an API key? <span className="chip ml-1.5">optional</span></span>
          <span className="muted text-xs">{showKey ? 'hide' : 'show'}</span>
        </button>
        {showKey && (
          <>
            <p className="muted text-sm">
              Billed to your Anthropic account, stored encrypted. Create one at <a className="underline underline-offset-2" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.
            </p>
            <ApiKeyForm hasKey={saved} readOnly={false} onSaved={() => setSaved(true)} />
          </>
        )}
      </div>
      <div className="flex items-center gap-4">
        <button type="button" className="btn-primary" onClick={onNext} disabled={!unlocked} data-connect-continue>
          {unlocked ? 'Continue — build your Pixie' : 'Waiting for a connection…'}
        </button>
        {!unlocked && (
          <button type="button" className="muted text-sm underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200" onClick={onNext}>
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Step 1: Face ─────────────────────────────────────────────────────────── */

function FaceStep({ cloneId, recipe, onRecipe, onNext, hasRail }: {
  cloneId: string;
  recipe: AvatarRecipe;
  onRecipe: (r: AvatarRecipe) => void;
  onNext: () => void;
  hasRail: boolean;
}) {
  const selfieGate = hasRail ? undefined : 'Selfie → Pixie needs your Claude connected (step 1 — the pairing takes a minute) — or Randomise / build by hand now and redo it from a selfie later.';
  const [mode, setMode] = useState<'choose' | 'edit'>('choose');
  const [confidence, setConfidence] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const lowConfidence = confidence ? Object.entries(confidence).filter(([, v]) => v < 0.6).map(([k]) => k) : [];

  async function saveAndContinue() {
    setPending(true);
    setError(null);
    try {
      const res = await saveAvatarAction(cloneId, recipe);
      if (!res.ok) { setError(res.error ?? 'Could not save your Pixie.'); return; }
      onNext();
    } catch {
      setError('Could not save your Pixie.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {mode === 'choose' ? (
        <div className="card space-y-4">
          <p className="muted text-sm">Your Pixie is your persona's pixel portrait. Start from a selfie, roll the dice, or build it by hand — you can fine-tune either way.</p>
          <SelfieUpload gate={selfieGate} onRecipe={(r, c) => { onRecipe(r); setConfidence(c); setMode('edit'); }} />
          <div className="muted text-xs">or</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => { onRecipe(randomRecipe()); setMode('edit'); }}>Randomise</button>
            <button type="button" className="btn-secondary" onClick={() => setMode('edit')}>Build by hand</button>
          </div>
        </div>
      ) : (
        <>
          <div className="card space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => { onRecipe(randomRecipe()); setError(null); }}>Randomise</button>
              <SelfieUpload gate={selfieGate} onRecipe={(r, c) => { onRecipe(r); setConfidence(c); setError(null); }} />
            </div>
            {lowConfidence.length > 0 && (
              <p className="text-xs text-amber-600">Low confidence on: {lowConfidence.join(', ')} — worth a second look below.</p>
            )}
          </div>
          <RecipeEditor recipe={recipe} onChange={(r) => { onRecipe(r); setError(null); }} />
        </>
      )}
      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" onClick={saveAndContinue} disabled={pending}>
          {pending ? 'Saving…' : 'This is me — continue'}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}

/* ── Step 2: Story ────────────────────────────────────────────────────────── */

function StoryStep({ cloneId, initial, onName, onRole, onNext }: {
  cloneId: string;
  initial: BuilderBrief;
  onName: (v: string) => void;
  onRole: (v: string) => void;
  onNext: () => void;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveBriefAction, null);
  const advanced = useRef(false);
  useEffect(() => {
    if (state?.ok && !advanced.current) { advanced.current = true; onNext(); }
  }, [state, onNext]);
  // Interview-first: four one-liners → the cheapest model drafts the story →
  // the form becomes "tweak the draft". Skippable both ways.
  const [mode, setMode] = useState<'interview' | 'form'>(initial.briefMd.trim() ? 'form' : 'interview');
  const [draft, setDraft] = useState<BuilderBrief | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const eff = draft ?? initial;

  async function runCompose(answers: InterviewAnswers) {
    setDrafting(true); setDraftErr(null);
    const r = await composeBriefAction(cloneId, initial.displayName, answers);
    setDrafting(false);
    if (!r.ok) {
      setDraftErr(r.error.startsWith('no_api_key') || r.error.startsWith('bridge_offline')
        ? 'Drafting needs your Claude connected (step 1) — write it by hand for now.'
        : `Drafting hiccuped (${r.error}) — write it by hand or try again.`);
      setMode('form');
      return;
    }
    setDraft({ displayName: initial.displayName, roleTitle: r.roleTitle, team: initial.team, briefMd: r.briefMd, operatingRules: r.operatingRules });
    onRole(r.roleTitle);
    setMode('form');
  }

  if (mode === 'interview') {
    return (
      <div className="space-y-3">
        <StoryInterview onDone={(a) => { void runCompose(a); }} onSkip={() => setMode('form')} busy={drafting} />
      </div>
    );
  }

  return (
    <form key={draft ? 'drafted' : 'blank'} action={action} className="card space-y-4">
      {draft ? (
        <p className="text-sm"><span className="chip border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400">✨ drafted from your answers</span> <span className="muted">Tweak anything — it should sound like you.</span> <button type="button" className="muted underline underline-offset-2" onClick={() => setMode('interview')}>redo the questions</button></p>
      ) : (
        <p className="muted text-sm">Who is this persona at work? 2–3 sentences is plenty — what do you do? how do you like to work? <button type="button" className="underline underline-offset-2" onClick={() => setMode('interview')}>or answer 4 quick questions and let AI draft it</button></p>
      )}
      {draftErr && <p className="text-xs text-amber-600">{draftErr}</p>}
      <input type="hidden" name="cloneId" value={cloneId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="displayName">Name</label>
          <input id="displayName" name="displayName" className="input" required defaultValue={eff.displayName} onChange={(e) => onName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="roleTitle">Role title</label>
          <input id="roleTitle" name="roleTitle" className="input" defaultValue={eff.roleTitle} placeholder="SOC engineer" onChange={(e) => onRole(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="team">Team</label>
          <input id="team" name="team" className="input" defaultValue={eff.team} placeholder="Security" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="briefMd">Your story</label>
        <p className="muted mb-1 text-xs">What you do, what you own, how you like to work. Your persona opens with this.</p>
        <textarea
          id="briefMd" name="briefMd" className="input min-h-32 text-sm" defaultValue={eff.briefMd}
          placeholder={'I run detection engineering for our SOC. I like short, direct answers with the evidence up front, and I always ask for a rollback plan.'}
        />
      </div>
      <div>
        <label className="label" htmlFor="operatingRules">Operating rules <span className="muted font-normal">(optional)</span></label>
        <p className="muted mb-1 text-xs">Hard rules, one per line — things your persona must never get wrong.</p>
        <textarea id="operatingRules" name="operatingRules" className="input min-h-20 text-sm" defaultValue={eff.operatingRules} placeholder="Never approve production changes on a Friday." />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}>{pending ? 'Saving…' : 'That’s my story — continue'}</button>
        {state && !state.ok && <span className="text-sm text-red-600">{state.error}</span>}
        {state?.warning && <span className="text-sm text-amber-600">{state.warning}</span>}
      </div>
    </form>
  );
}

/* ── Step 3: Mind ─────────────────────────────────────────────────────────── */

function MindStep({ cloneId, existingType, onType, onNext }: {
  cloneId: string;
  existingType: string | null;
  onType: (t: string) => void;
  onNext: () => void;
}) {
  const [view, setView] = useState<'intro' | 'test' | 'result'>(existingType ? 'result' : 'intro');
  const [result, setResult] = useState<MbtiResult | null>(null);
  const type = result?.type ?? existingType;

  return (
    <div className="space-y-4">
      {view === 'intro' && (
        <div className="card space-y-4">
          <p className="muted text-sm">
            A quick self-assessment — 24 questions, about 3 minutes — that colours how your persona speaks.
            What it learns from working with you always takes priority.
          </p>
          <div className="flex items-center gap-4">
            <button type="button" className="btn-primary" onClick={() => setView('test')}>Take the test</button>
            <button type="button" className="muted text-sm underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200" onClick={onNext}>
              Skip for now
            </button>
          </div>
        </div>
      )}

      {view === 'test' && (
        <div className="card">
          <MbtiTest cloneId={cloneId} onDone={(r) => { setResult(r); onType(r.type); setView('result'); }} />
          <button type="button" className="muted mt-3 text-xs underline underline-offset-2 hover:text-neutral-800 dark:hover:text-neutral-200" onClick={onNext}>
            Skip for now
          </button>
        </div>
      )}

      {view === 'result' && type && (
        <div className="card space-y-3">
          <p className="muted text-sm">Your persona’s lens:</p>
          <p className="text-[40px] font-semibold leading-none">{type}</p>
          <p className="muted text-xs">You can retake or inspect the full breakdown any time under your persona’s Personality tab.</p>
          <button type="button" className="btn-primary" onClick={onNext}>Continue</button>
        </div>
      )}
    </div>
  );
}

/* ── Step 5: Ready ────────────────────────────────────────────────────────── */

function ReadyStep({ displayName, roleTitle, mbtiType }: {
  displayName: string;
  roleTitle: string;
  mbtiType: string | null;
}) {
  const snapped = useRef(false);
  useEffect(() => {
    if (snapped.current) return;
    snapped.current = true;
    void finishOnboardingAction().catch(() => {}); // fire-and-forget snapshot
  }, []);

  return (
    <div className="card space-y-4">
      <p className="text-sm">
        <span className="font-medium">{displayName}</span> is ready.
        It will learn how you think from every conversation — the more you use it, the more it sounds like you.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="muted">Name</dt><dd>{displayName}</dd>
        {roleTitle && <><dt className="muted">Role</dt><dd>{roleTitle}</dd></>}
        {mbtiType && <><dt className="muted">Mind</dt><dd className="font-mono">{mbtiType}</dd></>}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Link href="/chat" className="btn-primary">Start chatting</Link>
        <Link href="/onboarding/sources" className="btn-secondary">Add learning sources</Link>
      </div>
    </div>
  );
}
