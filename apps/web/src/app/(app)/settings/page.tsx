import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';
import { requireOrg, isOrgAdmin } from '@/lib/session';
import { InviteCard } from '@/components/settings/InviteCard';
import { SettingsForm } from '@/components/settings/SettingsForm';
import { ApiKeyForm } from '@/components/settings/ApiKeyForm';
import { TwoFactorCard } from '@/components/settings/TwoFactorCard';
import { NamesCard } from '@/components/settings/NamesCard';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';
import { DevicesCard } from '@/components/settings/DevicesCard';
import { MembersCard } from '@/components/settings/MembersCard';
import { SettingsTabs } from '@/components/settings/SettingsTabs';
import { ConnectorCard } from '@/components/settings/ConnectorCard';
import { BridgeCard } from '@/components/settings/BridgeCard';
import { DangerZone } from '@/components/settings/DangerZone';

const MODEL_LABELS: Record<string, string> = {
  'claude-fable-5': 'Fable 5',
  'claude-opus-5': 'Opus 5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5': 'Haiku 4.5',
};

export default async function SettingsPage() {
  const ctx = await requireOrg();
  const [row] = await db.select().from(schema.orgSettings).where(eq(schema.orgSettings.orgId, ctx.orgId)).limit(1);
  const [userRow] = await db.select({ twoFactorEnabled: authSchema.user.twoFactorEnabled }).from(authSchema.user).where(eq(authSchema.user.id, ctx.userId)).limit(1);
  const [ownClone] = await db.select({ name: schema.clones.name }).from(schema.clones)
    .where(and(eq(schema.clones.orgId, ctx.orgId), eq(schema.clones.ownerUserId, ctx.userId), eq(schema.clones.kind, 'member'), sql`${schema.clones.archivedAt} is null`)).limit(1);
  const admin = isOrgAdmin(ctx);
  const pendingInvites = admin
    ? await db.select({ id: authSchema.invitation.id, email: authSchema.invitation.email, expiresAt: authSchema.invitation.expiresAt })
        .from(authSchema.invitation)
        .where(and(eq(authSchema.invitation.organizationId, ctx.orgId), eq(authSchema.invitation.status, 'pending'), gt(authSchema.invitation.expiresAt, new Date())))
    : [];
  const [{ n: memberCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(authSchema.member).where(eq(authSchema.member.organizationId, ctx.orgId));
  const showOrgTab = admin && (memberCount > 1 || pendingInvites.length > 0);
  // opportunistic tidy-up: drop this user's expired session rows
  await db.delete(authSchema.session).where(and(eq(authSchema.session.userId, ctx.userId), lt(authSchema.session.expiresAt, new Date())));
  const deviceSessions = await db
    .select({
      id: authSchema.session.id,
      userAgent: authSchema.session.userAgent,
      ipAddress: authSchema.session.ipAddress,
      createdAt: authSchema.session.createdAt,
      updatedAt: authSchema.session.updatedAt,
    })
    .from(authSchema.session)
    .where(and(eq(authSchema.session.userId, ctx.userId), gt(authSchema.session.expiresAt, new Date())))
    .orderBy(desc(authSchema.session.updatedAt));
  const baseUrl = (process.env.BETTER_AUTH_URL ?? '').replace(/\/$/, '');
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="muted text-sm">{ctx.orgName}{!admin && ' — member view'}</p>
      </div>
      <SettingsTabs
        account={
          <>
            <TwoFactorCard enabled={!!userRow?.twoFactorEnabled} email={ctx.user.email} />
            <ChangePasswordCard />
            <DevicesCard
              sessions={deviceSessions.map((r) => ({
                id: r.id,
                userAgent: r.userAgent,
                ipAddress: r.ipAddress,
                createdAt: r.createdAt.toISOString(),
                updatedAt: r.updatedAt.toISOString(),
                current: r.id === ctx.sessionId,
                stale: r.id !== ctx.sessionId && r.updatedAt.getTime() < Date.now() - 2 * 86400000,
              }))}
            />
            <NamesCard orgName={ctx.orgName} userName={ctx.user.name} canRenameOrg={false} />
            <DangerZone email={ctx.user.email} personaName={ownClone?.name ?? null} />
          </>
        }
        org={showOrgTab ? (
          <>
            <NamesCard orgName={ctx.orgName} userName={ctx.user.name} canRenameOrg showSelf={false} />
            <MembersCard orgId={ctx.orgId} selfUserId={ctx.userId} />
            <InviteCard
              baseUrl={baseUrl}
              pending={pendingInvites.map((i) => ({ id: i.id, email: i.email, expiresAt: i.expiresAt.toISOString() }))}
            />
          </>
        ) : undefined}
        models={
          <>
            <section className="card space-y-2">
              <h2 className="font-medium">Models &amp; defaults</h2>
              {!admin ? (
                <div>
                  <p className="muted text-xs">Org-wide defaults — set by the org owner/admin.</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                    {[
                      ['Chat model', MODEL_LABELS[row?.chatModel ?? 'claude-opus-5'] ?? (row?.chatModel ?? 'claude-opus-5')],
                      ['Chat effort', row?.chatEffort ?? 'high'],
                      ['Extraction model', MODEL_LABELS[row?.extractModel ?? 'claude-sonnet-5'] ?? (row?.extractModel ?? 'claude-sonnet-5')],
                      ['Condense model', MODEL_LABELS[row?.condenseModel ?? 'claude-haiku-4-5'] ?? (row?.condenseModel ?? 'claude-haiku-4-5')],
                      ['Timezone', row?.timezone ?? 'UTC'],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="muted text-xs">{k}</dt>
                        <dd className="font-medium">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="muted mt-3 text-xs">Any chat can still use its own model via the picker in the composer.</p>
                </div>
              ) : (
                <SettingsForm
                  readOnly={false}
                  initial={{
                    chatModel: row?.chatModel ?? 'claude-opus-5',
                    extractModel: row?.extractModel ?? 'claude-sonnet-5',
                    condenseModel: row?.condenseModel ?? 'claude-haiku-4-5',
                    chatEffort: row?.chatEffort ?? 'high',
                    timezone: row?.timezone ?? 'UTC',
                    monthlyBudgetUsd: row?.monthlyBudgetUsd ?? null,
                  }}
                />
              )}
            </section>
            <ConnectorCard />
            <BridgeCard />
            <section className="card space-y-2">
              <h2 className="font-medium">Claude access <span className="chip ml-2">API key</span></h2>
              <p className="muted text-xs">
                Bring your own key: usage is billed to your Anthropic account. Stored encrypted (AES-256-GCM) and never shown again.
                Anthropic&apos;s API data-retention policy applies to everything your personas send.
              </p>
              <ApiKeyForm hasKey={!!row?.anthropicKeyEnc} readOnly={!admin} />
            </section>
          </>
        }
      />
    </div>
  );
}
