import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getOrCreateOwnClone } from '@/lib/chat';

/** /chat — whoever is logged in lands in their latest conversation; ?new=1 starts one; ?mode=persona tests the persona. */
export default async function ChatShortcut({ searchParams }: { searchParams: Promise<{ new?: string; mode?: string }> }) {
  const ctx = await requireOrg();
  const sp = await searchParams;
  const clone = await getOrCreateOwnClone(ctx);
  const mode = sp.mode === 'clone' ? 'clone' as const : 'claude' as const;
  if (sp.new !== '1' && sp.mode === undefined) {
    const [last] = await db.select({ slug: schema.conversations.slug }).from(schema.conversations)
      .where(eq(schema.conversations.cloneId, clone.id)).orderBy(desc(schema.conversations.lastActivityAt)).limit(1);
    if (last) redirect(`/c/${last.slug}`);
  }
  const [row] = await db.insert(schema.conversations).values({ orgId: ctx.orgId, cloneId: clone.id, userId: ctx.userId, mode, title: mode === 'clone' ? 'Persona test' : 'New chat' }).returning({ slug: schema.conversations.slug });
  redirect(`/c/${row!.slug}`);
}
