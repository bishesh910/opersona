import Link from 'next/link';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireSession } from '@/lib/session';
import { listImportJobs } from '@/lib/imports';
import { ClaudeCodePanel } from '@/components/thinking/ClaudeCodePanel';
import { ImportPanel } from '@/components/thinking/ImportPanel';

/** Guided "teach your persona" step — right after the character builder, and linkable any time. */
export default async function SourcesPage() {
  const s = await requireSession();
  const [clone] = await db.select().from(schema.clones).where(eq(schema.clones.ownerUserId, s.userId)).limit(1);
  if (!clone) redirect('/onboarding');
  const id = clone.id;
  const [jobs, ccSessions, ccTokens] = await Promise.all([
    listImportJobs(id),
    db.select().from(schema.claudeCodeSessions).where(eq(schema.claudeCodeSessions.cloneId, id)).orderBy(desc(schema.claudeCodeSessions.createdAt)).limit(10),
    db.select({ id: schema.ingestTokens.id, name: schema.ingestTokens.name, createdAt: schema.ingestTokens.createdAt, lastUsedAt: schema.ingestTokens.lastUsedAt })
      .from(schema.ingestTokens).where(eq(schema.ingestTokens.cloneId, id)).orderBy(desc(schema.ingestTokens.createdAt)),
  ]);
  return (
    <div className="mx-auto max-w-2xl space-y-6 overflow-x-clip px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Teach your persona how you think</h1>
        <p className="muted mt-1 text-sm">
          Your persona learns your <em>reasoning</em> — how you break problems down, what you check first, when you act —
          not your answers. Three ways to feed it, from zero-effort to power-user. Pick any; you can add the rest later.
        </p>
      </div>

      <section className="card">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">1</span>
          <div className="min-w-0">
            <h2 className="font-medium">Just chat — nothing to set up</h2>
            <p className="muted mt-1 text-sm">
              Talk to Claude here the way you normally would — work problems, decisions, debugging, planning.
              Every finished conversation is analysed for reasoning moves in the background. A handful of real
              chats is enough for the first patterns to appear.
            </p>
            <Link href="/chat" className="btn-primary mt-3 inline-block">Start chatting</Link>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">2</span>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium">Import your claude.ai history</h2>
            <p className="muted mt-1 text-sm">The fastest way to a real fingerprint — months of your actual thinking in one upload:</p>
            <ol className="muted mt-2 list-decimal space-y-1 pl-5 text-sm">
              <li>On <span className="font-medium text-neutral-800 dark:text-neutral-200">claude.ai</span>: Settings → Privacy → <span className="font-medium text-neutral-800 dark:text-neutral-200">Export data</span></li>
              <li>Anthropic emails you a <code>.zip</code> (usually within minutes)</li>
              <li>Upload that zip here — nothing is stored except the extracted reasoning patterns</li>
            </ol>
            <div className="mt-4"><ImportPanel cloneId={id} initialJobs={jobs} readOnly={false} /></div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">3</span>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium">Use Claude Code? Add the hook</h2>
            <p className="muted mt-1 text-sm">Every coding session you finish is sent here automatically — your persona learns from how you debug and build, hands-free.</p>
            <div className="mt-4">
              <ClaudeCodePanel
                cloneId={id}
                readOnly={false}
                initialTokens={ccTokens.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt.toISOString(), lastUsedAt: t.lastUsedAt?.toISOString() ?? null }))}
                initialSessions={ccSessions.map((x) => ({
                  sessionId: x.sessionId, source: x.source, project: x.project, humanTurns: x.humanTurns, observations: x.observations,
                  status: x.status, note: x.note, createdAt: x.createdAt.toISOString(),
                }))}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <p className="muted text-xs">All of this lives under <span className="font-medium">My persona → How I think</span> whenever you need it.</p>
        <Link href="/chat" className="btn-secondary shrink-0">Done</Link>
      </div>
    </div>
  );
}
