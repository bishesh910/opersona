import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireSession, getOrgCtx } from '@/lib/session';
import { getOrCreateOwnClone } from '@/lib/chat';
import { CharacterBuilder } from '@/components/onboarding/CharacterBuilder';

export const dynamic = 'force-dynamic';

/**
 * First-run character builder. The current step is derived server-side from what
 * is still missing (no org → 1, no avatar → 2, empty brief → 3, no test → 4,
 * else 5), so a refresh resumes roughly where the user left off. A `?step=` param
 * (kept up to date by the client) lets the tail of the flow (Mind / Ready)
 * survive a refresh; without it, a fully-built persona goes straight to /chat.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string; step?: string }> }) {
  const s = await requireSession();
  const { error, step: stepParam } = await searchParams;
  const org = await getOrgCtx(s);

  if (!org) {
    return (
      <CharacterBuilder
        initialStep={1}
        userName={s.user.name}
        orgName={null}
        error={error ?? null}
        clone={null}
        brief={null}
        personalityType={null}
      />
    );
  }

  // Org exists: make sure the persona + brief rows exist (same as first /chat visit).
  const { id: cloneId } = await getOrCreateOwnClone(org);
  const [[clone], [brief], [personality]] = await Promise.all([
    db.select().from(schema.clones).where(eq(schema.clones.id, cloneId)).limit(1),
    db.select().from(schema.personaBriefs).where(eq(schema.personaBriefs.cloneId, cloneId)).limit(1),
    db.select({ type: schema.personalityTests.type }).from(schema.personalityTests)
      .where(eq(schema.personalityTests.cloneId, cloneId)).orderBy(desc(schema.personalityTests.createdAt)).limit(1),
  ]);

  const derived = !clone?.avatarRecipe ? 2 : !(brief?.briefMd ?? '').trim() ? 3 : !personality ? 4 : 5;
  const requested = Number(stepParam);
  const hasStep = Number.isInteger(requested) && requested >= 1 && requested <= 5;
  // Persona already built (face + story done, or the test — the last step — was
  // taken at some point) and not mid-flow → nothing to do here.
  if ((derived >= 4 || personality) && !hasStep) redirect('/chat');
  // Never past the first missing piece — except Ready, reachable when the test was skipped.
  const initialStep = Math.max(2, hasStep ? Math.min(requested, derived === 4 ? 5 : derived) : derived);

  return (
    <CharacterBuilder
      initialStep={initialStep}
      userName={s.user.name}
      orgName={org.orgName}
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
    />
  );
}
