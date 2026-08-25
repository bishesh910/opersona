import { redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@opersona/db';
import { requireOrg } from '@/lib/session';
import { getOrCreateOwnClone } from '@/lib/chat';

/** /chat — always lands in a FRESH chat (reusing the newest still-empty one so repeat
 *  taps don't pile up blank conversations); ?mode=clone tests the persona. Old chats
 *  live under "chats" / My persona → Chat. */
export default async function ChatShortcut({ searchParams }: { searchParams: Promise<{ new?: string; mode?: string }> }) {
  const ctx = await requireOrg();
  const sp = await searchParams;
  const clone = await getOrCreateOwnClone(ctx);
  const mode = sp.mode === 'clone' ? 'clone' as const : 'claude' as const;
  // Reuse the newest conversation of this mode if it never got a message.
  const [last] = await db.select({ id: schema.conversations.id, slug: schema.conversations.slug }).from(schema.conversations)
    .where(and(eq(schema.conversations.cloneId, clone.id), eq(schema.conversations.userId, ctx.userId), eq(schema.conversations.mode, mode)))
    .orderBy(desc(schema.conversations.createdAt)).limit(1);
  if (last) {
    const [t] = await db.select({ id: schema.turns.id }).from(schema.turns).where(eq(schema.turns.conversationId, last.id)).limit(1);
    if (!t) redirect(`/c/${last.slug}`);
  }
  const [row] = await db.insert(schema.conversations).values({ orgId: ctx.orgId, cloneId: clone.id, userId: ctx.userId, mode, title: mode === 'clone' ? 'Persona test' : 'New chat' }).returning({ slug: schema.conversations.slug });
  redirect(`/c/${row!.slug}`);
}
