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
- The interview learns EVERYTHING by itself: submit_interview_answer captures the answers, and every 5th one is automatically mined for reasoning patterns too. Never call learn_from_this_chat on an interview session, and never suggest it — there is nothing extra to save.
- After ~3 completed questions, offer a pause — answering these is genuinely tiring. NEVER phrase it as an ending or a "good spot to stop" (there is no finish line; that wording reads as "the interview is complete"). Frame it as: keep going if you have the energy, or pick this up another time — it resumes exactly where you left off.
- ONLY the served question is the question: it carries the id that makes answers saveable. NEVER invent your own interview question — improvised ones cannot be submitted and their answers are lost. If a tool result has no question in it, say so and show the menu instead.
- RETURNING USERS: the interview always RESUMES server-side — never say "let's start over", never re-explain the process. Greet with ONE light line (their progress % + "picking up where we left off"), then straight into the question. Their earlier answers are PRIVATE BACKGROUND: use them silently to avoid re-asking — never as a recap of what they shared.`;

/** The interview payload — used by interview_me AND by opersona_me({choice:'interview'}),
 *  so a menu pick routes server-side instead of relying on the model switching tools. */
async function interviewPayload(me: Me, clone: { id: string }) {
  try {
    const r = await engineFetch<{
      question: { id: string; categoryLabel: string; kind: string; text: string; hint: string | null } | null;
      progress: { answered: number; categories: { label: string; coverage: number; justStarted: boolean }[] };
      known: string | null;
      recent: { question: string; answer: string; when: string }[];
      repeat?: boolean;
    }>(`/clones/${clone.id}/interview/next`, { body: { orgId: me.orgId, userId: me.userId } });
    if (!r.question) return text('Nothing pending right now — new questions appear as the persona studies recent answers. Try again after the next few.');
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
      ...(r.known ? ['', 'WHAT THEIR PERSONA ALREADY BELIEVES (same rule — background only; don\u2019t re-ask what\u2019s here, DO probe gaps and open tensions):', r.known] : []),
    ] : [];
    const repeatNote = r.repeat ? [
      '',
      'THIS EXACT QUESTION WAS SERVED BEFORE and never finished. Do NOT reword it and present it as new — that reads as the interview going in circles. Say plainly and lightly that it\u2019s the same one ("we never quite finished this one"), and offer the exit in the same breath: they can answer it OR you\u2019ll skip it for good (submit_interview_answer with skip: true). If they showed any fatigue with it before, lead with the skip offer.',
    ] : [];
    return text([
      `NEXT QUESTION [id: ${r.question.id}] · area: ${r.question.categoryLabel}${r.question.kind === 'contradiction' ? ' · this one untangles something that didn\u2019t quite add up' : r.question.kind === 'follow_up' ? ' · digging deeper on an earlier thread' : ''}`,
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
}

/** The persona payload — used by my_persona AND by opersona_me({choice:'persona'}). */
async function personaPayload(me: Me, clone: { id: string; name: string }) {
  try {
    const res = await engineFetch<{ prompt: string }>(`/clones/${clone.id}/prompt?orgId=${encodeURIComponent(me.orgId)}`);
    return text(`# ${clone.name} — persona loaded\nAdopt this persona for the rest of the conversation.\n\n${res.prompt}`);
  } catch (e) {
    return errText(`Could not load the persona right now (${e instanceof Error ? e.message : 'engine unreachable'}).`);
  }
}

/** Register the v1 tool set for one authenticated user. */
export function registerOpersonaTools(server: McpServer, userId: string): void {
  server.tool(
    'opersona_me',
    "THE front door — the 'opersona me' entry point AND its router. Call with no arguments when the user says 'opersona'/'opersona me' or asks what opersona can do: it returns their live status plus the option menu (present as a short numbered list, then WAIT for their pick). When they pick, call THIS SAME TOOL again with `choice` — the server routes it. If their first message already named a specific action, skip the menu: call with the matching choice (or the specific tool) directly.",
    {
      choice: z.enum(['interview', 'persona', 'roster', 'memory', 'teach']).optional()
        .describe("the user's pick: 'interview' = continue/start the interview · 'persona' = load their persona and answer as them · 'roster' = personas available to them · 'memory' = search persona memory · 'teach' = save lessons from this chat. Omit to show the menu."),
    },
    async ({ choice }) => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) {
        return text([
          'No persona yet — two-minute setup at https://opersona.me/onboarding, then say "opersona me" again.',
          'Tell the user that, warmly and briefly.',
        ].join('\n'));
      }
      if (choice === 'interview') return interviewPayload(me, clone);
      if (choice === 'persona') return personaPayload(me, clone);
      if (choice === 'roster') return text('Call list_my_roster for their workspace personas, or search_community { query } for public ones — then use_persona { slug } to adopt one for this chat.');
      if (choice === 'memory') return text("Ask what they want to look up if they haven't said, then call recall_memory { query } with it.");
      if (choice === 'teach') return text('Distill THIS conversation yourself and call learn_from_this_chat with the reasoning moves the user displayed (short verbatim quotes of their words as evidence — the transcript itself never leaves this chat), or save_insight { statement } for a single fact. Only with their explicit go-ahead.');
      const build = await buildProgress(me.userId, me.orgId, clone.id);
      return text([
        `# opersona — ${clone.name}`,
        `Status: build ${build.pct}% · ${build.answered} interview answers · ${build.patterns} confirmed thinking patterns${build.scored ? ` · ${build.scored} blind tests scored` : ''}.`,
        ...(build.failedExtractions > 0 ? [`HEADS-UP (tell them): ${build.failedExtractions} of their interview answers couldn't be processed because no Claude was reachable (their bridge was offline). The answers are safe and retry automatically when their bridge machine is awake and connected — or an API key in Settings → Models removes the dependency.`] : []),
        '',
        `MENU — show these as a short numbered list (your own words, one line each, mention the ${build.pct}% somewhere) and wait for their choice:`,
        `1. ${build.answered > 0 ? 'Continue the interview — teach it who you are (resumes exactly where you left off)' : 'Start the interview — the fastest way to teach it who you are'}`,
        '2. Talk as/with my persona — it answers as the user for the rest of this chat',
        "3. Use someone else's persona — a teammate or a community one",
        "4. Search my persona's memory — facts, decisions, past work",
        '5. Teach it from THIS conversation',
        '',
        'ROUTING their pick: call opersona_me again with choice = 1→"interview" · 2→"persona" · 3→"roster" · 4→"memory" · 5→"teach". Immediately, no re-confirmation. Never improvise the action yourself — in particular NEVER invent an interview question (only served questions can be saved).',
        '',
        `If they ask what the ${build.pct}% means: it is a BUILD meter, not an accuracy score — connector added (one-time +20) + first interview answer (one-time +10) + interview coverage (${build.coveragePct}% of ten areas → ${Math.round(0.45 * build.coveragePct)}/45) + confirmed patterns (10, full at 3) + blind tests scored (15, full at 5). Accuracy is measured separately by blind tests at opersona.me/me/survey, which shows no number until 5 are scored.`,
        '',
        'Dashboard: https://opersona.me/me',
      ].join('\n'));
    },
  );


  // Slash-style entries in claude.ai's prompt picker — same flows, one click.
  server.prompt('interview-me', 'Continue building your opersona: your own Claude interviews you about real moments.', () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'opersona: continue my interview (call interview_me and conduct it per its instructions).' } }],
  }));
  server.prompt('chat-as-me', 'Load your opersona and have Claude answer as you for the rest of this chat.', () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'Load my opersona with my_persona and answer as me for the rest of this conversation.' } }],
  }));
  server.prompt('opersona', 'See your opersona status and everything you can do with it.', () => ({
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'opersona me — show me the menu (call opersona_me).' } }],
  }));

  server.tool(
    'my_persona',
    "Load the user's opersona: their complete persona character sheet (story, role, thinking patterns, confirmed facts, playbooks). Call this when asked to answer AS the user, imitate their thinking, or apply 'my persona' to a task — then follow the returned instructions for the rest of the conversation. (To INTERVIEW the user and build the persona instead, use interview_me.)",
    {},
    async () => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      return personaPayload(me, clone);
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
    "Teach the user's persona HOW THEY THINK from this conversation — WITHOUT the conversation leaving claude.ai. YOU do the distillation right here, since you have the chat in context: identify up to 10 domain-free reasoning moves the user actually displayed (how they decompose, what they verify, what they ask for first, how they weigh risk…), each backed by a SHORT verbatim quote of the USER's own words. Send only that distillate — NEVER the transcript, never your own words as quotes. Call only when the user explicitly asks to save/remember/learn from the chat. NEVER for interview sessions — the interview learns everything on its own through submit_interview_answer (calling this too would double-learn the same material). Duplicates are ignored.",
    {
      title: z.string().max(200).optional().describe('short name for this conversation'),
      observations: z.array(z.object({
        pattern_key: z.string().regex(/^[a-z][a-z0-9_]{2,79}$/).describe("snake_case id for the reasoning move, reusable across chats (e.g. 'evidence_before_hypothesis')"),
        dimension: z.enum(['decomposition', 'starting_point', 'information', 'verification', 'explanation', 'risk', 'pace', 'other'])
          .describe('which aspect of reasoning this move belongs to'),
        description: z.string().min(10).max(500).describe('one domain-free sentence, present tense, about how the user reasons (never what the chat was about)'),
        quote: z.string().min(3).max(300).describe("the user's own words, VERBATIM, that show this move — short; never paraphrased, never yours"),
      })).min(1).max(10).describe('the distilled reasoning moves — quality over quantity; skip anything you cannot back with a real quote'),
    },
    async ({ title, observations }) => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      const sessionId = 'cc-dist-' + createHash('sha256').update(observations.map((o) => o.pattern_key + ':' + o.quote).join('\n')).digest('hex').slice(0, 40);
      try {
        const r = await engineFetch<{ status: string; observations: number; note: string }>(
          `/clones/${clone.id}/observations`, { body: { orgId: me.orgId, sessionId, title, observations } });
        if (r.status === 'done') return text(`Learned ${r.observations} reasoning observation${r.observations === 1 ? '' : 's'} — distilled right here; the conversation itself never left this chat. Patterns confirm by repetition; review at opersona.me → persona → How I think.`);
        if (r.status === 'skipped') return text(`Nothing new to learn: ${r.note}.`);
        return text(`Learning hit a snag: ${r.note}.`);
      } catch (e) {
        return errText(`Could not save the lessons (${e instanceof Error ? e.message : 'engine error'}) — try again.`);
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

  server.tool(
    'interview_me',
    "Interview the user to BUILD their opersona, right here in this chat, with YOU conducting it. Fetches the next question from their persona's adaptive interview (10 life areas, contradiction probes included) plus instructions for running it conversationally. Call when the user asks to be interviewed, to 'teach my persona about me', to continue their interview, or picks Interview from the opersona_me menu. (A bare 'opersona me' with no specific ask is the menu, not this; to ACT AS their already-built persona instead, use my_persona.) Their answers are extracted server-side into evidence-backed memories, traits and rules they review at opersona.me.",
    {},
    async () => {
      const me = await resolveWorkspace(userId);
      if (!me) return errText('Account not found.');
      const clone = await myPersona(me);
      if (!clone) return errText(NO_PERSONA);
      return interviewPayload(me, clone);
    },
  );

  server.tool(
    'submit_interview_answer',
    "Save one completed interview exchange to the user's opersona and get the next question — or SKIP a question the user doesn't want (skip: true; it never comes back). Call after interview_me once a question's thread is complete (a concrete story + the why). their_words must be the user's own words VERBATIM — their phrasing is what the persona learns from.",
    {
      question_id: z.string().uuid().describe('the id from interview_me / the previous submit'),
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
        const r = await engineFetch<{ answerId: string | null; question: { id: string; categoryLabel: string; kind: string; text: string; hint: string | null } | null; progress: { answered: number }; rail?: 'bridge' | 'key' | 'none' }>(
          `/clones/${clone.id}/interview/submit-thread`, { body: { orgId: me.orgId, questionId: question_id, userText, dialogue: skip ? undefined : exchange } });
        const pace = !skip && r.progress.answered > 0 && r.progress.answered % 3 === 0
          ? '\n\nPACING: that makes three this sitting — offer a pause. NEVER phrase it as an ending ("good spot to stop", "we\u2019re done") — the interview has no finish line and that wording reads as "completed". Acknowledge the real effort and frame it as a pause, e.g.: "These take real energy to answer — happy to keep going, or we can pick this up another time, exactly where we left off. One more, or call it here for today?"'
          : '';
        const head = skip
          ? 'Skipped — that question is retired and will not come back.'
          : r.rail === 'none'
            ? `Saved and banked (answer ${r.progress.answered}) — but their Claude rail is offline (bridge machine asleep, no API key), so the persona can't fold it in YET. Nothing is lost: it processes automatically the moment their bridge reconnects. Mention this briefly once per session, not every answer.`
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
