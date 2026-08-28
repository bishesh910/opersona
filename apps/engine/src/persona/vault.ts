/**
 * Vault export — the persona's brain as a folder of markdown files that opens
 * directly in Obsidian. Read-only artefact: README + Brief + Personality +
 * Patterns/<pattern_key>.md + Episodes/<date> <slug>.md, with [[wikilinks]]
 * from pattern evidence to the episode note of the conversation it came from.
 * Sessions/transcripts are deliberately NOT included (too big, too raw); source
 * refs stay as plain text. Owner-only — enforced by the web proxy.
 */
import AdmZip from 'adm-zip';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db, clones, personaBriefs, personalityTests, reasoningPatterns, reasoningObservations, episodes } from '@opersona/db';
import { describeMbti, describeStatedMbti, type Axis } from '@opersona/shared';

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Safe for filenames AND for [[wikilinks]] (no \/:*?"<>|#^[] and no leading dots). */
export function sanitizeName(s: string, max = 80): string {
  const out = s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, max).trim();
  return out || 'untitled';
}

const slugify = (s: string, max = 60) => sanitizeName(s, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '') || 'untitled';

export async function exportVault(orgId: string, cloneId: string): Promise<{ buffer: Buffer; filename: string }> {
  const [clone] = await db.select().from(clones).where(and(eq(clones.id, cloneId), eq(clones.orgId, orgId))).limit(1);
  if (!clone) throw new Error('clone not found');
  const [brief] = await db.select().from(personaBriefs).where(eq(personaBriefs.cloneId, cloneId)).limit(1);
  const [personality] = await db.select().from(personalityTests).where(eq(personalityTests.cloneId, cloneId)).orderBy(desc(personalityTests.createdAt)).limit(1);
  const patterns = await db.select().from(reasoningPatterns).where(eq(reasoningPatterns.cloneId, cloneId)).orderBy(desc(reasoningPatterns.strength));
  const obs = await db.select().from(reasoningObservations).where(eq(reasoningObservations.cloneId, cloneId)).orderBy(asc(reasoningObservations.createdAt));
  const eps = await db.select().from(episodes).where(eq(episodes.cloneId, cloneId)).orderBy(desc(episodes.createdAt));

  const name = brief?.displayName?.trim() || clone.name;
  const zip = new AdmZip();
  const add = (path: string, content: string) => zip.addFile(path, Buffer.from(content.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', 'utf8'));

  // ── Episodes/ — one note per remembered conversation ──────────────────────
  const episodeNote = new Map<string, string>(); // conversationId → note name (no folder, no .md)
  const used = new Set<string>();
  for (const e of eps) {
    let base = `${day(e.createdAt)} ${slugify(e.title)}`;
    if (used.has(base)) base = `${base}-${e.id.slice(0, 6)}`;
    used.add(base);
    if (e.conversationId) episodeNote.set(e.conversationId, base);
    const lines = [
      `# ${sanitizeName(e.title, 200)}`,
      '',
      `- Date: ${day(e.createdAt)}`,
      `- Outcome: ${e.outcome}`,
      ...(e.domain ? [`- Domain: ${e.domain}`] : []),
      ...(e.turnCount ? [`- Turns: ${e.turnCount}`] : []),
      ...(e.conversationId ? [`- Source: conversation ${e.conversationId}`] : e.sourceRef ? [`- Source: ${e.sourceKind} ${e.sourceRef}`] : []),
      '',
      '## Problem', '', e.problem || '_(not recorded)_',
      '', '## Approach', '', e.approachSummary || '_(not recorded)_',
    ];
    if (e.keyDecisions.length) { lines.push('', '## Key decisions', ''); for (const d of e.keyDecisions) lines.push(`- ${d}`); }
    add(`Episodes/${base}.md`, lines.join('\n'));
  }

  // ── Patterns/ — one note per reasoning pattern, evidence as blockquotes ───
  let patternCount = 0;
  for (const p of patterns) {
    if (p.status === 'rejected') continue;
    patternCount++;
    const mine = obs.filter((o) => o.patternKey === p.patternKey);
    const lines = [
      `# ${sanitizeName(p.patternKey)}`,
      '',
      p.description,
      '',
      `- Dimension: ${p.dimension}`,
      `- Status: ${p.status}${p.userVerdict ? ` (owner said: ${p.userVerdict})` : ''}`,
      `- Strength: ${p.strength.toFixed(2)}`,
      `- Seen in ${p.nSources} conversation(s), ${day(p.firstSeenAt)} → ${day(p.lastSeenAt)}`,
    ];
    const quotes: string[] = [];
    for (const o of mine.slice(-12)) {
      const link = o.sourceKind === 'conversation' && episodeNote.has(o.sourceRef)
        ? `[[Episodes/${episodeNote.get(o.sourceRef)}]]` : `${o.sourceKind} ${o.sourceRef}`;
      for (const ev of o.evidence) quotes.push(`> ${ev.quote.replace(/\n/g, ' ')}\n> — ${link}${o.weight < 0 ? ' _(counter-evidence)_' : ''}`);
    }
    if (!quotes.length) for (const ex of p.examples.slice(0, 6)) quotes.push(`> ${ex.replace(/\n/g, ' ')}`);
    if (quotes.length) lines.push('', '## Evidence', '', quotes.join('\n\n'));
    add(`Patterns/${sanitizeName(p.patternKey)}.md`, lines.join('\n'));
  }

  // ── Brief / Personality ───────────────────────────────────────────────────
  if (brief && (brief.briefMd.trim() || brief.roleTitle.trim() || brief.operatingRules.trim())) {
    const lines = [`# ${name}`, ''];
    if (brief.roleTitle.trim() || brief.team.trim()) lines.push(`**${brief.roleTitle.trim() || '—'}**${brief.team.trim() ? ` · ${brief.team.trim()}` : ''}`, '');
    if (brief.briefMd.trim()) lines.push(brief.briefMd.trim(), '');
    if (brief.operatingRules.trim()) lines.push('## Hard rules', '', brief.operatingRules.trim());
    add('Brief.md', lines.join('\n'));
  }
  if (personality) {
    add('Personality.md', personality.source === 'stated' ? [
      `# Personality (self-reported): ${personality.type}`,
      '',
      describeStatedMbti(personality.type),
      '',
      `_Stated directly ${day(personality.createdAt)} — no per-axis strengths were measured. Self-report is flavour; observed patterns win._`,
    ].join('\n') : [
      `# Personality (self-reported): ${personality.type}`,
      '',
      describeMbti({ type: personality.type, scores: personality.scores }),
      '',
      '## Axis scores',
      '',
      ...(Object.entries(personality.scores) as [Axis, number][]).map(([axis, v]) => `- ${axis}: ${v}`),
      '',
      `_Taken ${day(personality.createdAt)}. Self-report is flavour; observed patterns win._`,
    ].join('\n'));
  }

  // ── README ────────────────────────────────────────────────────────────────
  add('README.md', [
    `# ${name} — brain vault`,
    '',
    `A read-only markdown export of everything this persona has learned about ${name}: who they are, how they think (reasoning patterns with verbatim evidence), and episodic memory of past conversations. Open this folder as a vault in Obsidian — evidence quotes link to the episode they came from.`,
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Patterns: ${patternCount}`,
    `- Episodes: ${eps.length}`,
    `- Brief: ${brief && brief.briefMd.trim() ? 'yes' : 'no'} · Personality: ${personality ? personality.type : 'no'}`,
    '',
    'Raw conversation transcripts are intentionally not included; episode and pattern notes reference their source conversations by id.',
  ].join('\n'));

  return { buffer: zip.toBuffer(), filename: `${sanitizeName(name, 40).replace(/\s+/g, '_')}.vault.zip` };
}
