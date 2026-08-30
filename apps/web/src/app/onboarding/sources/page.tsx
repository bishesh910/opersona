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
            <h2 className="font-medium">Talk on claude.ai — with the connector attached</h2>
            <p className="muted mt-1 text-sm">
              Use claude.ai the way you already do. With the opersona connector, your Claude can save what it
              learns about you (<code className="text-xs">learn_from_this_chat</code>), recall your persona&apos;s
              memory mid-conversation — and say <span className="font-medium text-neutral-800 dark:text-neutral-200">&ldquo;opersona me&rdquo;</span>{' '}
              any time to be interviewed about real moments. That interview is the fastest way to teach it who you are.
            </p>
            <p className="muted mt-2 text-sm">
              Live in the terminal? The same connector works in <span className="font-medium text-neutral-800 dark:text-neutral-200">Claude Code</span>:{' '}
              <code className="text-xs">claude mcp add --transport http opersona https://opersona.me/mcp</code>, then <code className="text-xs">/mcp</code> to
              sign in — your persona&apos;s memory and the interview, right where you work.
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">2</span>
          <div className="min-w-0 flex-1">
            <h2 className="font-medium">Import your claude.ai or ChatGPT history</h2>
            <p className="muted mt-1 text-sm">The fastest way to a real fingerprint — months of your actual thinking in one upload:</p>
            <ol className="muted mt-2 list-decimal space-y-1 pl-5 text-sm">
              <li>On <span className="font-medium text-neutral-800 dark:text-neutral-200">claude.ai</span>: Settings → Privacy → <span className="font-medium text-neutral-800 dark:text-neutral-200">Export data</span></li>
              <li>Or on <span className="font-medium text-neutral-800 dark:text-neutral-200">chatgpt.com</span>: Settings → Data controls → <span className="font-medium text-neutral-800 dark:text-neutral-200">Export data</span></li>
              <li>You get a <code>.zip</code> by email (usually within minutes)</li>
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
            <h2 className="font-medium">Learn from coding sessions (Claude Code · Codex)</h2>
            <p className="muted mt-1 text-sm">With the Claude Code hook, every session you finish is sent here automatically — and you can upload <code>.jsonl</code> sessions from Claude Code or Codex CLI any time. Your persona learns from how you debug and build.</p>
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
        <Link href="/me" className="btn-secondary shrink-0">Done</Link>
      </div>
    </div>
  );
}
