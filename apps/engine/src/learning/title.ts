/** LLM-summarized conversation titles ("Keycloak reset vulnerability" — the topic,
 *  not the first message). Fired after the FIRST assistant reply; manual renames
 *  are respected (we only replace defaults / first-message echoes). */
import { and, asc, eq } from 'drizzle-orm';
import { db, conversations, turns } from '@opersona/db';
import { textCall } from '../llm.js';
import { orgModelConfig } from '../keys.js';

const DEFAULTISH = /^(Chat \d{4}|Clone test|Persona test|Conversation |New conversation|New chat)/;

export async function maybeTitleConversation(orgId: string, cloneId: string, conversationId: string): Promise<void> {
  const rows = await db.select({ role: turns.role, content: turns.content }).from(turns)
    .where(eq(turns.conversationId, conversationId)).orderBy(asc(turns.createdAt)).limit(4);
  const users = rows.filter((r) => r.role === 'user');
  const assistants = rows.filter((r) => r.role === 'assistant');
  if (users.length !== 1 || assistants.length !== 1) return; // only after the very first exchange
  const [conv] = await db.select({ title: conversations.title }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conv) return;
  const firstMsg = users[0]!.content.slice(0, 400);
  // replace defaults AND the crude first-message echo; never a human-chosen name
  const crudeEcho = conv.title.trim() !== '' && firstMsg.replace(/\s+/g, ' ').startsWith(conv.title.replace(/…$/, '').replace(/\s+/g, ' ').slice(0, 30));
  if (!DEFAULTISH.test(conv.title) && !crudeEcho) return;
  const cfg = await orgModelConfig(orgId);
  const raw = await textCall({ orgId, cloneId, kind: 'title', apiKey: cfg.apiKey, model: cfg.condenseModel, effort: 'low',
    system: 'Title this conversation for a sidebar: 3-6 words, the TOPIC (what it is about), no quotes, no trailing punctuation, same language as the user.',
    user: `USER:\n${firstMsg}\n\nASSISTANT:\n${assistants[0]!.content.slice(0, 600)}` });
  const title = raw.trim().replace(/^["'“]|["'”]$/g, '').replace(/[.。]$/, '').slice(0, 80);
  if (title.length < 3) return;
  await db.update(conversations).set({ title }).where(and(eq(conversations.id, conversationId), eq(conversations.title, conv.title))); // don't stomp a concurrent rename
}
