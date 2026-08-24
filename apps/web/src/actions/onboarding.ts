'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { requireSession, requireOrg } from '@/lib/session';
import { getOrCreateOwnClone } from '@/lib/chat';
import { snapshotClone } from '@/lib/engine';

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createOrganizationAction(form: FormData) {
  await requireSession();
  const name = String(form.get('name') ?? '').trim();
  if (name.length < 2) redirect('/onboarding?error=Name+too+short');
  const h = await headers();
  let orgId: string;
  try {
    const org = await auth.api.createOrganization({ headers: h, body: { name, slug: slugify(name) } });
    if (!org) throw new Error('organization not created');
    orgId = org.id;
    await auth.api.setActiveOrganization({ headers: h, body: { organizationId: orgId } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to create organization';
    redirect(`/onboarding?error=${encodeURIComponent(msg)}`);
  }
  redirect('/onboarding');
}

/** Last step of the character builder: render the persona snapshot once everything is in place. */
export async function finishOnboardingAction(): Promise<{ ok: boolean }> {
  const ctx = await requireOrg();
  const clone = await getOrCreateOwnClone(ctx);
  const snap = await snapshotClone(clone.id, ctx.orgId);
  return { ok: snap.ok };
}
