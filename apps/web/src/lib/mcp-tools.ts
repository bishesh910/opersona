/**
 * The opersona MCP toolbox — what a connected claude.ai can do on behalf of the
 * signed-in person. Free-tier heart of the platform: the persona is built and
 * learns here, but the THINKING runs inside claude.ai on the user's own
 * subscription. Every tool resolves the user's personal workspace first and
 * never reaches outside it.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema, authSchema } from '@opersona/db';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { engineFetch } from '@/lib/engine';
import { ensurePersonalWorkspace } from '@/lib/workspace';
import { getPublishedBySlug, canViewPublished, isSlug } from '@/lib/community';
import { buildProgress } from '@/lib/persona-progress';

interface Me { userId: string; orgId: string }

async function resolveWorkspace(userId: string): Promise<Me | null> {
  // Admission control: tools stay closed until a platform admin approves the account.
  const [u0] = await db.select({ approvedAt: authSchema.user.approvedAt }).from(authSchema.user).where(eq(authSchema.user.id, userId)).limit(1);
  if (!u0?.approvedAt) return null;
  const rows = await db.select({ orgId: authSchema.member.organizationId }).from(authSchema.member)
    .where(eq(authSchema.member.userId, userId)).orderBy(asc(authSchema.member.createdAt)).limit(1);
  if (rows[0]) return { userId, orgId: rows[0].orgId };
  const [u] = await db.select({ id: authSchema.user.id, name: authSchema.user.name, email: authSchema.user.email })
    .from(authSchema.user).where(eq(authSchema.user.id, userId)).limit(1);
  if (!u) return null;
  return { userId, orgId: await ensurePersonalWorkspace(u) };
}

async function myPersona(me: Me) {
  const [clone] = await db.select().from(schema.clones)
    .where(and(eq(schema.clones.orgId, me.orgId), eq(schema.clones.ownerUserId, me.userId), eq(schema.clones.kind, 'member'), isNull(schema.clones.archivedAt)))
    .orderBy(asc(schema.clones.createdAt)).limit(1);
  return clone ?? null;
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const errText = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });
const NO_PERSONA = 'No persona yet — build one at https://opersona.me/onboarding first (it takes about two minutes).';

/** Register the v1 tool set for one authenticated user. */
export function registerOpersonaTools(server: McpServer, userId: string): void {
  server.tool(
    'opersona_menu',
    "THE front door. Call when the user says 'opersona' or 'opersona me' WITHOUT a more specific ask, or asks what opersona can do. Returns their live status plus the option menu — present it as a short numbered list in your own words and WAIT for their pick, then call the matching tool. If their message already named a specific action ('interview me', 'load my persona', 'use X's persona'), skip the menu and call that tool directly.",
    {},
    async () => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) {
        return text([
          'No persona yet — two-minute setup at https://opersona.me/onboarding, then say "opersona me" again.',
          'Tell the user that, warmly and briefly.',
        ].join('\n'));
      }
      const build = await buildProgress(me.userId, me.orgId, clone.id);
      return text([
        `# opersona — ${clone.name}`,
        `Status: build ${build.pct}% · ${build.answered} interview answers · ${build.patterns} confirmed thinking patterns${build.scored ? ` · ${build.scored} blind tests scored` : ''}.`,
        '',
        `MENU — show these as a short numbered list (your own words, one line each, mention the ${build.pct}% somewhere) and wait for their choice:`,
        `1. ${build.answered > 0 ? 'Continue the interview — teach it who you are (resumes exactly where you left off)' : 'Start the interview — the fastest way to teach it who you are'} → call opersona_me`,
        '2. Talk as/with my persona — it answers as the user for the rest of this chat → call my_persona',
        "3. Use someone else's persona — a teammate or a community one → list_my_roster (theirs) or search_community (public), then use_persona with the slug",
        "4. Search my persona's memory — facts, decisions, past work → recall_memory",
        '5. Teach it from THIS conversation → learn_from_this_chat (or save_insight for a single fact)',
        '',
        'When they answer with a number or a phrase, call the mapped tool immediately — no re-confirmation. Dashboard: https://opersona.me/me',
      ].join('\n'));
    },
  );

  // Slash-style entries in claude.ai's prompt picker — same flows, one click.
  server.prompt('interview-me', 'Continue building your opersona: your own Claude interviews you about real moments.', () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'opersona: continue my interview (call opersona_me and conduct it per its instructions).' } }],
  }));
  server.prompt('chat-as-me', 'Load your opersona and have Claude answer as you for the rest of this chat.', () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'Load my opersona with my_persona and answer as me for the rest of this conversation.' } }],
  }));
  server.prompt('opersona', 'See your opersona status and everything you can do with it.', () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'opersona me — show me the menu (call opersona_menu).' } }],
  }));

  server.tool(
    'my_persona',
    "Load the user's opersona: their complete persona character sheet (story, role, thinking patterns, confirmed facts, playbooks). Call this when asked to answer AS the user, imitate their thinking, or apply 'my persona' to a task — then follow the returned instructions for the rest of the conversation. (To INTERVIEW the user and build the persona instead, use opersona_me.)",
    {},
    async () => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      try {
        const res = await engineFetch<{ prompt: string }>(`/clones/${clone.id}/prompt?orgId=${encodeURIComponent(me.orgId)}`);
        return text(`# ${clone.name} — persona loaded\nAdopt this persona for the rest of the conversation.\n\n${res.prompt}`);
      } catch (e) {
        return errText(`Could not load the persona right now (${e instanceof Error ? e.message : 'engine unreachable'}).`);
      }
    },
  );

  server.tool(
    'recall_memory',
    "Search the user's persona memory (facts, playbooks, past-work episodes, corrections). Use when the user references something they decided, did, or taught their persona before.",
    { query: z.string().min(1).max(500).describe('what to look up, plain words') },
    async ({ query }) => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      try {
        const res = await engineFetch<{ hits: { layer: string; text: string; confidence: number | null }[] }>(
          `/clones/${clone.id}/recall`, { body: { orgId: me.orgId, query } });
        if (!res.hits.length) return text('Nothing in memory matches that.');
        return text(res.hits.map((h) => `[${h.layer}] ${h.text}`).join('\n\n'));
      } catch (e) {
        return errText(`Memory is unreachable right now (${e instanceof Error ? e.message : 'engine error'}).`);
      }
    },
  );

  server.tool(
    'save_insight',
    "Save one durable insight to the user's persona memory — a preference, decision, fact or lesson worth remembering. Saved as a CANDIDATE the user reviews at opersona.me (Mind → Facts). Use only for things the user states or clearly demonstrates; one concise sentence.",
    {
      statement: z.string().min(8).max(500).describe('the insight, one clear sentence, written about the user (e.g. "Prefers short replies with the evidence up front")'),
      domain: z.string().max(80).optional().describe('optional topic tag, e.g. "code review"'),
    },
    async ({ statement, domain }) => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      const recent = await db.select({ id: schema.facts.id }).from(schema.facts)
        .where(and(eq(schema.facts.cloneId, clone.id), eq(schema.facts.statement, statement))).limit(1);
      if (recent[0]) return text('Already remembered — that exact insight is in memory.');
      await db.insert(schema.facts).values({
        orgId: me.orgId, cloneId: clone.id,
        statement, domain: domain || null, tags: [],
        status: 'candidate', sourceKind: 'teach', createdBy: me.userId,
        confidence: 0.7, evidence: [], lastReinforcedAt: new Date(),
      });
      return text(`Saved as a candidate memory. ${clone.name} reviews it at opersona.me → persona → Mind.`);
    },
  );

  server.tool(
    'learn_from_this_chat',
    "Teach the user's persona from THIS conversation. Call only when the user explicitly asks to save/remember/learn from the chat. Pass the conversation so far as ordered turns (their words verbatim where possible — the persona learns from HOW they think, so their phrasing matters more than yours). The persona's memory updates within a minute; duplicates are ignored.",
    {
      title: z.string().max(200).optional().describe('short name for this conversation'),
      turns: z.array(z.object({ role: z.enum(['human', 'assistant']), text: z.string().max(50_000) })).min(2).max(200)
        .describe("the conversation so far, in order; 'human' = the user"),
    },
    async ({ title, turns }) => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      const sessionId = 'cc-' + createHash('sha256').update(turns.map((t) => t.role + ':' + t.text).join('\n')).digest('hex').slice(0, 40);
      try {
        const r = await engineFetch<{ status: string; observations: number; note: string }>(
          `/clones/${clone.id}/learn-transcript`, { body: { orgId: me.orgId, sessionId, title, turns } });
        if (r.status === 'done') return text(`Learned from this conversation — ${r.observations} new observation${r.observations === 1 ? '' : 's'} about how ${clone.name} thinks. Review them at opersona.me → persona → Thinking.`);
        if (r.status === 'skipped') return text(`Nothing new to learn: ${r.note}.`);
        return errText(`Could not learn from this chat: ${r.note}`);
      } catch (e) {
        return errText(`Learning is unreachable right now (${e instanceof Error ? e.message : 'engine error'}).`);
      }
    },
  );

  server.tool(
    'use_persona',
    "Adopt another persona for this conversation: one from the user's workspace (imported or hired specialists, by name) or any published community persona (by its slug from opersona.me/p/<slug> or search_community). Returns the persona's instructions — follow them for the rest of the conversation. Access rules are enforced: restricted personas open only for people their author granted.",
    { name_or_slug: z.string().min(1).max(120).describe("a persona's name from the user's roster, or a published slug like 'ada-baker-x7k2'") },
    async ({ name_or_slug }) => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const needle = name_or_slug.trim();
      // 1) roster match by name (case-insensitive)
      const roster = await db.select().from(schema.clones)
        .where(and(eq(schema.clones.orgId, me.orgId), isNull(schema.clones.archivedAt)));
      const local = roster.find((c) => c.name.toLowerCase() === needle.toLowerCase());
      if (local) {
        try {
          // A colleague's own persona opens at the VISITOR audience — the owner
          // render (private facts, lessons, episodes) is for the owner alone.
          const audience = local.kind === 'member' && local.ownerUserId !== me.userId ? '&audience=visitor' : '';
          const res = await engineFetch<{ prompt: string }>(`/clones/${local.id}/prompt?orgId=${encodeURIComponent(me.orgId)}${audience}`);
          return text(`# ${local.name} — persona loaded${local.kind === 'imported' ? ' (imported copy)' : ''}\nAdopt this persona for the rest of the conversation.\n\n${res.prompt}`);
        } catch (e) {
          return errText(`Could not load ${local.name} right now (${e instanceof Error ? e.message : 'engine unreachable'}).`);
        }
      }
      // 2) published persona by slug (visibility + grants enforced)
      if (isSlug(needle.toLowerCase())) {
        const pub = await getPublishedBySlug(needle.toLowerCase());
        if (pub) {
          const [u] = await db.select({ email: authSchema.user.email }).from(authSchema.user).where(eq(authSchema.user.id, me.userId)).limit(1);
          if (await canViewPublished(pub, u ? { userId: me.userId, email: u.email } : null)) {
            return text(`# ${pub.artifact.persona.name} — shared persona loaded (published by ${pub.artifact.author.name}, v${pub.version})\nAdopt this persona for the rest of the conversation.\n\n${pub.artifact.systemPrompt}`);
          }
        }
      }
      return errText(`No persona named "${needle}" in the workspace, and no published persona with that slug is visible to this account. Try list_my_roster or search_community.`);
    },
  );

  server.tool(
    'search_community',
    'Search the public opersona community for published personas by name, role or topic. Returns matches with their slug — pass a slug to use_persona to adopt one.',
    { query: z.string().min(1).max(200).describe('what kind of persona to look for') },
    async ({ query }) => {
      // Same admission gate as every other tool — unapproved accounts get nothing.
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const rows = await db.select().from(schema.publishedPersonas)
        .where(and(eq(schema.publishedPersonas.visibility, 'public'), eq(schema.publishedPersonas.status, 'active')))
        .orderBy(desc(schema.publishedPersonas.importCount)).limit(200);
      const needle = query.trim().toLowerCase();
      const hits = rows.filter((r) => [r.artifact.persona.name, r.artifact.persona.roleTitle ?? '', r.artifact.persona.bio ?? '', r.artifact.author.name]
        .some((f) => f.toLowerCase().includes(needle))).slice(0, 10);
      if (!hits.length) return text(`No public personas match "${query}". Browse https://opersona.me/explore for the full gallery.`);
      return text(hits.map((r) =>
        `- ${r.artifact.persona.name} (slug: ${r.slug})${r.artifact.persona.roleTitle ? ` — ${r.artifact.persona.roleTitle}` : ''}${r.artifact.persona.bio ? `\n  ${r.artifact.persona.bio}` : ''}\n  by ${r.artifact.author.name} · ${r.artifact.stats.patterns} patterns · added ${r.importCount}×`,
      ).join('\n'));
    },
  );

  const INTERVIEWER_BRIEF = `HOW TO CONDUCT THIS (you are the interviewer now — building an evidence-based portrait, never flattering or typing them):
- Ask the question conversationally in your own words — a curious friend, never a form or a therapist. ONE question at a time; never batch. Keep your own turns SHORT — they should be doing most of the talking.
- Episodes, not self-description: never let an answer rest on a trait claim ("I'm pretty organised"). Steer to one specific incident — a time, a place, the people who were there.
- Probe 1-3 times when it earns its place, each probe a different target: what they actually DID, what they were THINKING in the moment, what happened NEXT, what they'd do DIFFERENTLY. If they deflect or go thin twice, stop probing and submit what you have.
- NEVER CIRCLE: each probe must open a genuinely NEW angle — never re-collect something they already gave you in different words ("how did you choose" then "what made you go with that choice" is the same question twice; users hate it). If their first answer already contains a concrete story AND the why, submit immediately and move on.
- Stay neutral and curious: no interpretations, no verdicts, no compliments mid-interview — never "that's so insightful". (Neutral is not cold: the empathy rule below still stands.)
- If they seem tired of a question, find it too personal, or say it feels repetitive, offer to skip it (submit_interview_answer with skip: true) — it retires permanently. Never push a question twice.
- Pacing is server-side: early questions are deliberately low-stakes; heavier territory (regret, loss, failure) unlocks as answers accumulate. Don't escalate on your own ahead of the served question.
- If they share something heavy or unresolved, be a person FIRST — name the weight simply ("that's a lot to carry") and stay on that thread; never change the subject away from something raw. If they ask what YOU think they should do, be honest that their persona is still learning them, then ask what each option would actually mean for them.
- When the thread has a concrete story plus the reason underneath, call submit_interview_answer with the question_id, their words VERBATIM (their phrasing is what their persona learns from — never paraphrase), and the exchange. Then flow into the next question it returns.
- After ~3 completed questions, offer a natural break ("that's plenty for one sitting") — they can always continue.
- RETURNING USERS: the interview always RESUMES server-side — never say "let's start over", never re-explain the process. Greet with ONE light line (their progress % + "picking up where we left off"), then straight into the question. Their earlier answers are PRIVATE BACKGROUND: use them silently to avoid re-asking — never as a recap of what they shared.`;

  server.tool(
    'opersona_me',
    "Interview the user to BUILD their opersona, right here in this chat, with YOU conducting it. Fetches the next question from their persona's adaptive interview (10 life areas, contradiction probes included) plus instructions for running it conversationally. Call when the user asks to be interviewed, to 'teach my persona about me', to continue their interview, or picks Interview from the opersona_menu options. (A bare 'opersona me' with no specific ask goes to opersona_menu first; to ACT AS their already-built persona instead, use my_persona.) Their answers are extracted server-side into evidence-backed memories, traits and rules they review at opersona.me.",
    {},
    async () => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      try {
        const r = await engineFetch<{
          question: { id: string; categoryLabel: string; kind: string; text: string; hint: string | null } | null;
          progress: { answered: number; categories: { label: string; coverage: number; justStarted: boolean }[] };
          known: string | null;
          recent: { question: string; answer: string; when: string }[];
          repeat?: boolean;
        }>(`/clones/${clone.id}/interview/next`, { body: { orgId: me.orgId, userId: me.userId } });
        if (!r.question) return text('Nothing pending right now — new questions appear as the persona studies recent answers. Try again after the next few.');
        // THE user-facing number = the build meter on their opersona.me nav bar
        // (connector + interview coverage + patterns + blind tests). One figure,
        // one meaning, everywhere — the raw interview coverage is interviewer
        // detail only, never the headline.
        const build = await buildProgress(me.userId, me.orgId, clone.id);
        const pct = build.pct;
        const coverage = r.progress.answered > 0
          ? `So far: ${r.progress.answered} answers · interview coverage ${build.coveragePct}% of the ten areas · overall build ${pct}% (the same number as the progress bar on their opersona.me nav).`
          : 'This is early days — first answers teach it the most.';
        const returning = r.progress.answered > 0;
        const resume = returning ? [
          '',
          `RESUMING: picks up exactly where they left off (${r.progress.answered} answers banked) — answered questions never come back.`,
          `GREET LIGHT, THEN THE QUESTION: one short upbeat line that INCLUDES THE NUMBER ${pct}% — e.g. "Welcome back — your opersona is at ${pct}% and we're picking up right where we left off." That figure matches the progress bar they see on opersona.me — say it verbatim, don't soften it into "building". Do NOT recap what they told you before — being handed a summary of your own personal disclosures feels invasive, not warm. Mention a past topic only if THEY bring it up first.`,
          ...(r.recent?.length ? [
            'PRIVATE BACKGROUND — for your awareness only, so you never re-ask or contradict. Never recite, quote, or summarize any of this back to them:',
            ...r.recent.map((x) => `- asked: ${x.question} → they said: "${x.answer}"`),
          ] : []),
          ...(r.known ? ['', 'WHAT THEIR PERSONA ALREADY BELIEVES (same rule — background only; don’t re-ask what’s here, DO probe gaps and open tensions):', r.known] : []),
        ] : [];
        const repeatNote = r.repeat ? [
          '',
          'THIS EXACT QUESTION WAS SERVED BEFORE and never finished. Do NOT reword it and present it as new — that reads as the interview going in circles. Say plainly and lightly that it\u2019s the same one ("we never quite finished this one"), and offer the exit in the same breath: they can answer it OR you\u2019ll skip it for good (submit_interview_answer with skip: true). If they showed any fatigue with it before, lead with the skip offer.',
        ] : [];
        return text([
          `NEXT QUESTION [id: ${r.question.id}] · area: ${r.question.categoryLabel}${r.question.kind === 'contradiction' ? ' · this one untangles something that didn’t quite add up' : r.question.kind === 'follow_up' ? ' · digging deeper on an earlier thread' : ''}`,
          `"${r.question.text}"${r.question.hint ? `\n(${r.question.hint})` : ''}`,
          ...repeatNote,
          '',
          coverage,
          ...resume,
          '',
          INTERVIEWER_BRIEF,
        ].join('\n'));
      } catch (e) {
        return errText(`The interview backend is unreachable right now (${e instanceof Error ? e.message : 'engine error'}).`);
      }
    },
  );

  server.tool(
    'submit_interview_answer',
    "Save one completed interview exchange to the user's opersona and get the next question — or SKIP a question the user doesn't want (skip: true; it never comes back). Call after opersona_me once a question's thread is complete (a concrete story + the why). their_words must be the user's own words VERBATIM — their phrasing is what the persona learns from.",
    {
      question_id: z.string().uuid().describe('the id from opersona_me / the previous submit'),
      their_words: z.string().max(20_000).optional().describe("the user's own messages from this thread, verbatim, joined by newlines — never paraphrased, never yours. Omit when skipping."),
      skip: z.boolean().optional().describe("true = the user doesn't want this question (bored, too personal, feels repetitive) — retire it permanently and move to the next"),
      exchange: z.array(z.object({ role: z.enum(['user', 'interviewer']), text: z.string().max(4000) })).max(24).optional()
        .describe('the full back-and-forth in order (your questions included) so short answers stay interpretable'),
    },
    async ({ question_id, their_words, skip, exchange }) => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      const userText = skip ? '' : (their_words ?? '').trim();
      if (!skip && !userText) return errText('their_words is required unless skip is true.');
      try {
        const r = await engineFetch<{ answerId: string | null; question: { id: string; categoryLabel: string; kind: string; text: string; hint: string | null } | null; progress: { answered: number } }>(
          `/clones/${clone.id}/interview/submit-thread`, { body: { orgId: me.orgId, questionId: question_id, userText, dialogue: skip ? undefined : exchange } });
        const pace = !skip && r.progress.answered > 0 && r.progress.answered % 3 === 0
          ? '\n\nPACING: that makes three this sitting — offer them a natural break before continuing.'
          : '';
        const head = skip
          ? 'Skipped — that question is retired and will not come back.'
          : `Saved — the persona is folding it in (answer ${r.progress.answered}).`;
        if (!r.question) return text(`${head} No more questions pending right now.${pace}`);
        return text([
          `${head} Flow naturally into the next one:`,
          '',
          `NEXT QUESTION [id: ${r.question.id}] · area: ${r.question.categoryLabel}${r.question.kind === 'contradiction' ? ' · this one untangles something that didn’t quite add up' : ''}`,
          `"${r.question.text}"${r.question.hint ? `\n(${r.question.hint})` : ''}`,
          pace,
        ].join('\n'));
      } catch (e) {
        return errText(`Could not save that exchange (${e instanceof Error ? e.message : 'engine error'}) — their words are still in this chat; try again.`);
      }
    },
  );

  server.tool(
    'list_my_roster',
    "List the personas in the user's opersona workspace (their own plus any hired specialists), with roles.",
    {},
    async () => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clones = await db.select({ id: schema.clones.id, name: schema.clones.name, kind: schema.clones.kind, archivedAt: schema.clones.archivedAt })
        .from(schema.clones).where(eq(schema.clones.orgId, me.orgId)).orderBy(desc(schema.clones.createdAt));
      const live = clones.filter((c) => !c.archivedAt);
      if (!live.length) return text(NO_PERSONA);
      const briefs = await db.select({ cloneId: schema.personaBriefs.cloneId, roleTitle: schema.personaBriefs.roleTitle }).from(schema.personaBriefs)
        .where(inArray(schema.personaBriefs.cloneId, live.map((c) => c.id)));
      const roleOf = new Map(briefs.map((b) => [b.cloneId, b.roleTitle]));
      return text(live.map((c) => `- ${c.name}${roleOf.get(c.id) ? ` — ${roleOf.get(c.id)}` : ''}${c.kind === 'hired' ? ' (hired specialist)' : ''}`).join('\n'));
    },
  );
}
