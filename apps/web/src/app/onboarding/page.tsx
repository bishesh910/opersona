import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireSession, getOrgCtx } from '@/lib/session';
import { getOrCreateOwnClone } from '@/lib/chat';
import { CharacterBuilder } from '@/components/onboarding/CharacterBuilder';
import { orgHasChatKey } from '@/lib/keys';

export const dynamic = 'force-dynamic';

/**
 * First-run character builder: Pixie → Story → Mind → Connect → Ready. The
 * personal workspace is auto-created at signup (and self-healed by getOrgCtx),
 * so there is no team step. The current step is derived server-side from what
 * is still missing (no avatar → 1, empty brief → 2, no test → 3, no key → 4,
 * else 5); a `?step=` param (kept up to date by the client) lets the tail of
 * the flow survive a refresh; a fully-built persona goes straight to /chat.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string; step?: string }> }) {
  const s = await requireSession();
  const { error, step: stepParam } = await searchParams;
  const org = await getOrgCtx(s);
  if (!org) redirect('/sign-in'); // self-heal failed hard (db down mid-request) — nothing sensible to render

  const { id: cloneId } = await getOrCreateOwnClone(org);
  const [[clone], [brief], [personality], [settings]] = await Promise.all([
    db.select().from(schema.clones).where(eq(schema.clones.id, cloneId)).limit(1),
    db.select().from(schema.personaBriefs).where(eq(schema.personaBriefs.cloneId, cloneId)).limit(1),
    db.select({ type: schema.personalityTests.type }).from(schema.personalityTests)
      .where(eq(schema.personalityTests.cloneId, cloneId)).orderBy(desc(schema.personalityTests.createdAt)).limit(1),
    db.select({ anthropicKeyEnc: schema.orgSettings.anthropicKeyEnc }).from(schema.orgSettings).where(eq(schema.orgSettings.orgId, org.orgId)).limit(1),
  ]);

  const hasApiKey = !!settings?.anthropicKeyEnc;
  const hasRail = hasApiKey || await orgHasChatKey(org.orgId);
  // Connect comes FIRST: pairing the bridge (or claude.ai / a key) unlocks every
  // door after it — selfie extraction, chat, learning. Then Pixie → Story → Mind.
  const derived = !hasRail ? 1 : !clone?.avatarRecipe ? 2 : !(brief?.briefMd ?? '').trim() ? 3 : !personality ? 4 : 5;
  const requested = Number(stepParam);
  const hasStep = Number.isInteger(requested) && requested >= 1 && requested <= 5;
  const doneEnough = !!clone?.avatarRecipe && !!(brief?.briefMd ?? '').trim();
  // Persona already built (face + story done) and not mid-flow → nothing to do here.
  if (doneEnough && !hasStep) redirect('/me');
  // Mid-flow the URL's ?step= wins outright (clamping back to the first missing
  // piece made every refresh yank people out of the step they were on).
  const initialStep = hasStep ? Math.min(Math.max(requested, 1), 5) : derived;

  return (
    <CharacterBuilder
      initialStep={initialStep}
      userName={s.user.name}
      error={error ?? null}
      clone={{ id: cloneId, recipe: clone?.avatarRecipe ?? null }}
      brief={{
        displayName: brief?.displayName ?? clone?.name ?? s.user.name,
        roleTitle: brief?.roleTitle ?? '',
        team: brief?.team ?? '',
        briefMd: brief?.briefMd ?? '',
        operatingRules: brief?.operatingRules ?? '',
      }}
      personalityType={personality?.type ?? null}
      hasApiKey={hasApiKey}
      hasRail={hasRail}
    />
  );
}
