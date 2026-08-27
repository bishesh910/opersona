'use client';
/**
 * Publish UI — informed consent by construction: the exact artifact is
 * previewable before anything goes live, section toggles decide what's in it,
 * and default visibility is RESTRICTED (the owner flips to public on purpose).
 */
import { useEffect, useState, useTransition } from 'react';
import type { PersonaArtifact } from '@opersona/shared';
import {
  publishAction, unpublishAction, setVisibilityAction, addGrantAction, removeGrantAction,
  previewArtifactAction, type PublishState, type PublishInput,
} from '@/actions/publish';

const msg = (e: unknown) => (e instanceof Error ? e.message.replace(/^.*Error: /, '') : 'something went wrong');

export function ShareCard({ cloneId, name, initial }: { cloneId: string; name: string; initial: PublishState }) {
  const pub = initial.published;
  const live = !!pub && pub.status === 'active';
  const [bio, setBio] = useState(pub?.bio ?? '');
  const [visibility, setVisibility] = useState<'public' | 'restricted'>(pub?.visibility ?? 'restricted');
  const [sections, setSections] = useState({
    facts: pub?.sections.facts !== false,
    playbooks: pub?.sections.playbooks !== false,
    personality: pub?.sections.personality !== false,
  });
  const [attest, setAttest] = useState(live);
  const [preview, setPreview] = useState<PersonaArtifact | null>(null);
  const [grantEmail, setGrantEmail] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const input: PublishInput = { bio, visibility, sections };
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const url = pub && origin ? `${origin}/p/${pub.slug}` : null;

  const run = (fn: () => Promise<void>) => start(async () => {
    try { setErr(null); setNote(null); await fn(); } catch (e) { setErr(msg(e)); }
  });

  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-5">
        <div>
          <h2 className="font-medium">Share {name} with the world</h2>
          <p className="muted mt-1 text-sm">
            Publishing creates a frozen snapshot others can add to their own workspace. It contains ONLY
            confirmed entries you marked shareable — never conversations, documents, evidence quotes or episodes.
            Copies run on the importer&apos;s own Claude and never learn anything new about you.
          </p>
        </div>

        {live && url && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
            <p className="font-medium text-emerald-800 dark:text-emerald-300">Live — v{pub.version} · {pub.visibility === 'public' ? 'public' : 'restricted to people you grant'}{pub.importCount > 0 && <> · added by {pub.importCount}</>}</p>
            <p className="mt-1 break-all font-mono text-xs">{url}</p>
            <button type="button" className="btn-secondary btn-sm mt-2" onClick={() => { void navigator.clipboard?.writeText(url); setNote('link copied'); }}>copy link</button>
          </div>
        )}
        {pub && pub.status !== 'active' && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {pub.status === 'unpublished' ? 'Currently unpublished — the page 404s. Publish again to bring it back at the same link.' : 'Delisted after review — contact us if you think that is wrong.'}
          </p>
        )}

        <label className="block text-sm">
          <span className="font-medium">Short bio for the public page</span>
          <textarea className="input mt-1 w-full" rows={2} maxLength={500} value={bio} onChange={(e) => setBio(e.target.value)}
            placeholder={`What does ${name} bring? One or two sentences.`} />
        </label>

        <fieldset className="space-y-1.5 text-sm">
          <legend className="font-medium">What goes in</legend>
          <label className="flex items-center gap-2"><input type="checkbox" checked disabled /> How you think (confirmed patterns — descriptions only, never evidence quotes)</label>
          {([['facts', 'Shareable facts'], ['playbooks', 'Shareable playbooks'], ['personality', 'Personality (MBTI self-report)']] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" checked={sections[k]} onChange={(e) => setSections({ ...sections, [k]: e.target.checked })} /> {label}
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-1.5 text-sm">
          <legend className="font-medium">Who can see it</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="vis" checked={visibility === 'restricted'} onChange={() => setVisibility('restricted')} className="mt-0.5" />
            <span><span className="font-medium">Only people I choose</span> <span className="muted">— grant by email below (the default)</span></span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="vis" checked={visibility === 'public'} onChange={() => setVisibility('public')} className="mt-0.5" />
            <span><span className="font-medium">Public</span> <span className="muted">— anyone can view and add it; it appears in Explore</span></span>
          </label>
        </fieldset>

        <div className="space-y-2">
          <button type="button" className="btn-secondary btn-sm" disabled={pending}
            onClick={() => run(async () => setPreview(await previewArtifactAction(cloneId, input)))}>
            {preview ? 'Refresh preview' : 'Preview exactly what will be shared'}
          </button>
          {preview && (
            <pre className="max-h-72 overflow-auto rounded bg-neutral-100 p-2 font-mono text-[11px] dark:bg-neutral-800">{JSON.stringify(preview, null, 2)}</pre>
          )}
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-0.5" />
          <span>I reviewed the preview; everything in it is mine to share, and I understand that people who already
            added my persona keep their copy even if I unpublish.</span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" disabled={pending || !attest}
            onClick={() => run(async () => {
              const r = await publishAction(cloneId, input);
              setNote(`published v${r.version}`);
              window.location.reload();
            })}>
            {pending ? 'Working…' : live ? 'Republish (new version)' : 'Publish'}
          </button>
          {live && (
            <>
              <button type="button" className="btn-secondary" disabled={pending}
                onClick={() => run(async () => { await setVisibilityAction(cloneId, visibility); setNote(`visibility: ${visibility}`); })}>
                Save visibility
              </button>
              <button type="button" className="btn-secondary" disabled={pending}
                onClick={() => run(async () => { await unpublishAction(cloneId); window.location.reload(); })}>
                Unpublish
              </button>
            </>
          )}
        </div>
        {note && <p className="text-xs text-emerald-700 dark:text-emerald-400">{note}</p>}
        {err && <p className="text-xs text-red-600 dark:text-red-400" role="alert">{err}</p>}
      </div>

      {pub && (
        <div className="card space-y-3 p-5">
          <div>
            <h3 className="font-medium">People with access</h3>
            <p className="muted mt-0.5 text-xs">
              {visibility === 'public' ? 'The persona is public, so grants are only needed if you switch back to restricted.' : 'Only these people (and you) can open the page or add the persona. Grants work before they even have an account — matched by the email they sign up with.'}
            </p>
          </div>
          <div className="flex gap-2">
            <input className="input flex-1 text-sm" type="email" placeholder="friend@example.com" value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)} aria-label="Grant access by email" />
            <button type="button" className="btn-secondary" disabled={pending || !grantEmail}
              onClick={() => run(async () => {
                const r = await addGrantAction(cloneId, grantEmail);
                if (!r.ok) throw new Error(r.error);
                setGrantEmail('');
                window.location.reload();
              })}>
              Grant
            </button>
          </div>
          {pub.grants.length > 0 && (
            <ul className="space-y-1 text-sm">
              {pub.grants.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{g.email} {g.redeemed && <span className="chip ml-1">joined</span>}</span>
                  <button type="button" className="muted text-xs hover:text-red-600 hover:underline" disabled={pending}
                    onClick={() => run(async () => { await removeGrantAction(cloneId, g.id); window.location.reload(); })}>
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
