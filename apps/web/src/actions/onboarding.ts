'use server';
import { requireOrg } from '@/lib/session';
import { getOrCreateOwnClone } from '@/lib/chat';
import { snapshotClone } from '@/lib/engine';

/** Last step of the character builder: render the persona snapshot once everything is in place. */
export async function finishOnboardingAction(): Promise<{ ok: boolean }> {
  const ctx = await requireOrg();
  const clone = await getOrCreateOwnClone(ctx);
  const snap = await snapshotClone(clone.id, ctx.orgId);
  return { ok: snap.ok };
}
