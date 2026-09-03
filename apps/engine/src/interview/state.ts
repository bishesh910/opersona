/**
 * Interview knowledge-state assembly — everything the picker, the extractor
 * prompt and the coverage cache need, computed fresh from the DB (interview
 * volumes are small; correctness beats caching). `interview_coverage` is a
 * UI cache only, refreshed here after answers/extractions.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  db, interviewAnswers, interviewQuestions, interviewCoverage, traits, contextualRules, memories, contradictions,
} from '@opersona/db';
import { INTERVIEW_CATEGORIES, type InterviewCategory } from '@opersona/shared';
import { computeCoverage, type CategoryCoverage, type CoverageAnswer, type AnswerQuality } from './coverage.js';
import type { PickerState } from './nextQuestion.js';

const isCategory = (c: string | null): c is InterviewCategory => !!c && (INTERVIEW_CATEGORIES as readonly string[]).includes(c);

export interface InterviewState extends PickerState {
  coverageList: CategoryCoverage[];
}

export async function loadInterviewState(cloneId: string): Promise<InterviewState> {
  const [answerRows, traitRows, ruleRows, memoryRows, openContra] = await Promise.all([
    db.select({
      id: interviewAnswers.id, questionText: interviewAnswers.questionText,
      category: interviewAnswers.category, skipped: interviewAnswers.skipped,
      extraction: interviewAnswers.extraction, createdAt: interviewAnswers.createdAt,
      facet: interviewQuestions.facet,
    }).from(interviewAnswers)
      .leftJoin(interviewQuestions, eq(interviewQuestions.id, interviewAnswers.questionId))
      .where(eq(interviewAnswers.cloneId, cloneId))
      .orderBy(desc(interviewAnswers.createdAt)),
    db.select({ category: traits.category, tier: traits.tier, confidence: traits.confidence, status: traits.status })
      .from(traits).where(eq(traits.cloneId, cloneId)),
    db.select({ category: contextualRules.category, tier: contextualRules.tier, status: contextualRules.status })
      .from(contextualRules).where(eq(contextualRules.cloneId, cloneId)),
    db.select({ category: memories.category, status: memories.status })
      .from(memories).where(eq(memories.cloneId, cloneId)),
    db.select({ category: interviewAnswers.category })
      .from(contradictions)
      .leftJoin(interviewAnswers, eq(interviewAnswers.id, contradictions.answerId))
      .where(and(eq(contradictions.cloneId, cloneId), inArray(contradictions.status, ['open', 'probed']))),
  ]);

  const live = (s: string) => s !== 'retired' && s !== 'disputed';
  const perCat = Object.fromEntries(INTERVIEW_CATEGORIES.map((c) => [c, {
    answers: [] as CoverageAnswer[], items: { explicit: 0, inferred: 0 }, openContradictions: 0,
  }])) as Record<InterviewCategory, { answers: CoverageAnswer[]; items: { explicit: number; inferred: number }; openContradictions: number }>;

  for (const a of answerRows) {
    if (!isCategory(a.category)) continue;
    perCat[a.category].answers.push({
      category: a.category, facet: a.facet ?? null,
      quality: (a.extraction?.quality as AnswerQuality | undefined) ?? null,
      skipped: a.skipped,
    });
  }
  for (const t of traitRows) {
    if (!isCategory(t.category) || !live(t.status)) continue;
    perCat[t.category].items[t.tier === 'explicit' ? 'explicit' : 'inferred']++;
  }
  for (const r of ruleRows) {
    if (!isCategory(r.category) || !live(r.status)) continue;
    perCat[r.category].items[r.tier === 'explicit' ? 'explicit' : 'inferred']++;
  }
  for (const m of memoryRows) {
    if (!isCategory(m.category) || !live(m.status)) continue;
    perCat[m.category].items.explicit++; // a memory is the person's own account of what happened
  }
  for (const c of openContra) if (isCategory(c.category)) perCat[c.category].openContradictions++;

  const coverageList = INTERVIEW_CATEGORIES.map((category) => computeCoverage({ category, ...perCat[category] }));
  const coverage = Object.fromEntries(coverageList.map((c) => [c.category, c])) as Record<InterviewCategory, CategoryCoverage>;

  const uncertainty = Object.fromEntries(INTERVIEW_CATEGORIES.map((cat) => {
    const confs = traitRows.filter((t) => t.category === cat && live(t.status)).map((t) => t.confidence);
    return [cat, confs.length ? confs.reduce((s, c) => s + (1 - c), 0) / confs.length : 1];
  })) as Record<InterviewCategory, number>;

  const recentCategories = answerRows.filter((a) => !a.skipped && isCategory(a.category)).slice(0, 3).map((a) => a.category as InterviewCategory);
  const recentSkippedFacets = answerRows.slice(0, 10).filter((a) => a.skipped && a.facet).map((a) => a.facet!) as string[];
  // Turn history for the thread rules: skips count as turns (the person still sat through them).
  const recentAnswerIds = answerRows.slice(0, 12).map((a) => a.id);
  const recentQuestionTexts = answerRows.slice(0, 6).map((a) => a.questionText);

  return { coverage, coverageList, uncertainty, recentCategories, recentSkippedFacets, recentAnswerIds, recentQuestionTexts };
}

/** Refresh the interview_coverage cache (the UI reads this). */
export async function storeCoverage(orgId: string, cloneId: string): Promise<void> {
  const state = await loadInterviewState(cloneId);
  for (const c of state.coverageList) {
    await db.insert(interviewCoverage)
      .values({ cloneId, category: c.category, orgId, coverage: c.coverage, facets: c.facets, answered: c.answered, openContradictions: c.openContradictions })
      .onConflictDoUpdate({
        target: [interviewCoverage.cloneId, interviewCoverage.category],
        set: { coverage: c.coverage, facets: c.facets, answered: c.answered, openContradictions: c.openContradictions, updatedAt: new Date() },
      });
  }
}

/** Capped digest of what we already believe — fed to the extractor so it reuses
 *  trait keys and spots tensions instead of coining near-duplicates. */
export async function knownDigest(cloneId: string, maxChars = 4000): Promise<string> {
  const [traitRows, contraRows, memoryRows] = await Promise.all([
    db.select({ kind: traits.kind, key: traits.key, label: traits.label, statement: traits.statement, tier: traits.tier, status: traits.status })
      .from(traits).where(and(eq(traits.cloneId, cloneId), inArray(traits.status, ['candidate', 'confirmed'])))
      .orderBy(desc(traits.confidence)).limit(60),
    db.select({ description: contradictions.description })
      .from(contradictions).where(and(eq(contradictions.cloneId, cloneId), inArray(contradictions.status, ['open', 'probed'])))
      .limit(10),
    db.select({ summary: memories.summary })
      .from(memories).where(and(eq(memories.cloneId, cloneId), inArray(memories.status, ['candidate', 'confirmed'])))
      .orderBy(desc(memories.importance)).limit(15),
  ]);
  const parts: string[] = [];
  if (traitRows.length) {
    parts.push('KNOWN TRAITS (reuse these keys when the same thing comes up again):');
    for (const t of traitRows) parts.push(`- ${t.key} [${t.kind}/${t.tier}] ${t.label}: ${t.statement}`);
  }
  if (contraRows.length) {
    parts.push('', 'OPEN TENSIONS (unresolved):');
    for (const c of contraRows) parts.push(`- ${c.description}`);
  }
  if (memoryRows.length) {
    parts.push('', 'KNOWN MEMORIES:');
    for (const m of memoryRows) parts.push(`- ${m.summary}`);
  }
  const out = parts.join('\n');
  return out.length > maxChars ? out.slice(0, maxChars) + '\n[truncated]' : out || '(nothing known yet)';
}
