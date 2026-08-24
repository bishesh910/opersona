import { and, eq, gt } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';
import { requireOrg, isOrgAdmin } from '@/lib/session';
import { InviteCard } from '@/components/settings/InviteCard';
import { SettingsForm } from '@/components/settings/SettingsForm';
import { ApiKeyForm } from '@/components/settings/ApiKeyForm';
import { TwoFactorCard } from '@/components/settings/TwoFactorCard';
import { engineFetch } from '@/lib/engine';

export default async function SettingsPage() {
  const ctx = await requireOrg();
  const [row] = await db.select().from(schema.orgSettings).where(eq(schema.orgSettings.orgId, ctx.orgId)).limit(1);
  const [userRow] = await db.select({ twoFactorEnabled: authSchema.user.twoFactorEnabled }).from(authSchema.user).where(eq(authSchema.user.id, ctx.userId)).limit(1);
  const admin = isOrgAdmin(ctx);
  const mode = await engineFetch<{ mode: string }>('/auth/mode').then((j) => j.mode).catch(() => 'api-key');
  const hostLogin = mode === 'host-login';
  const pendingInvites = admin
    ? await db.select({ id: authSchema.invitation.id, email: authSchema.invitation.email, expiresAt: authSchema.invitation.expiresAt })
        .from(authSchema.invitation)
        .where(and(eq(authSchema.invitation.organizationId, ctx.orgId), eq(authSchema.invitation.status, 'pending'), gt(authSchema.invitation.expiresAt, new Date())))
    : [];
  const baseUrl = (process.env.BETTER_AUTH_URL ?? '').replace(/\/$/, '');
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Organization settings</h1>
        <p className="muted text-sm">{ctx.orgName}{!admin && ' — read-only (org owner/admin can edit)'}</p>
      </div>
      <section className="card space-y-2">
        <h2 className="font-medium">Claude access</h2>
        {hostLogin ? (
          <>
            <p className="text-sm">
              <span className="chip">pilot mode</span> Using the <strong>Claude login on this machine</strong> (your claude.ai subscription) — no API key needed.
            </p>
            <p className="muted text-xs">
              Chats and selfie processing run through Claude Code under that login. For a multi-user deployment
              switch the engine to <code>ENGINE_AUTH_MODE=api-key</code> and give each org its own API key below{row?.anthropicKeyEnc ? ' (one is already stored and takes precedence)' : ''}.
            </p>
            <details className="text-xs"><summary className="cursor-pointer muted">Optional: use an API key instead</summary><div className="pt-2"><ApiKeyForm hasKey={!!row?.anthropicKeyEnc} readOnly={!admin} /></div></details>
          </>
        ) : (
          <>
            <p className="muted text-xs">
              Bring your own key: usage is billed to your Anthropic account. Stored encrypted (AES-256-GCM) and never shown again.
              Anthropic&apos;s API data-retention policy applies to everything your personas send.
            </p>
            <ApiKeyForm hasKey={!!row?.anthropicKeyEnc} readOnly={!admin} />
          </>
        )}
      </section>
      {admin && (
        <InviteCard
          baseUrl={baseUrl}
          pending={pendingInvites.map((i) => ({ id: i.id, email: i.email, expiresAt: i.expiresAt.toISOString() }))}
        />
      )}
      <TwoFactorCard enabled={!!userRow?.twoFactorEnabled} />
      <section className="card space-y-2">
        <h2 className="font-medium">Models &amp; defaults</h2>
        <SettingsForm
          readOnly={!admin}
          initial={{
            chatModel: row?.chatModel ?? 'claude-opus-5',
            extractModel: row?.extractModel ?? 'claude-sonnet-5',
            condenseModel: row?.condenseModel ?? 'claude-haiku-4-5',
            chatEffort: row?.chatEffort ?? 'high',
            timezone: row?.timezone ?? 'UTC',
            monthlyBudgetUsd: row?.monthlyBudgetUsd ?? null,
          }}
        />
      </section>
    </div>
  );
}
