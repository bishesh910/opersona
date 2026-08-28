/**
 * Persona export — the owner's full private backup: brief, fingerprint (with
 * evidence), facts, playbooks, interview knowledge (memories / traits /
 * contextual rules with tiers and evidence), interview answers, prediction-test
 * results, corrections, avatar recipe, rendered prompt. Owner-only (the web
 * proxy enforces it). The privacy-safe SHARED artifact for publishing is a
 * separate shape — see `sharedArtifact.ts` (`opersona/persona@1`).
 */
import { and, asc, eq, ne } from 'drizzle-orm';
import {
  db, clones, personaBriefs, facts, playbooks, reasoningPatterns,
  memories, traits, contextualRules, interviewAnswers, predictionScenarios, corrections,
} from '@opersona/db';
import { type PatternRow } from '../learning/fingerprint.js';
import { activePrompt } from './assemble.js';

export async function exportPersona(orgId: string, cloneId: string) {
  const [clone] = await db.select().from(clones).where(and(eq(clones.id, cloneId), eq(clones.orgId, orgId))).limit(1);
  if (!clone) throw new Error('clone not found');
  const [brief] = await db.select().from(personaBriefs).where(eq(personaBriefs.cloneId, cloneId)).limit(1);
  const patterns = (await db.select().from(reasoningPatterns).where(eq(reasoningPatterns.cloneId, cloneId))) as unknown as PatternRow[];
  const fs = await db.select().from(facts).where(and(eq(facts.cloneId, cloneId), eq(facts.status, 'confirmed')));
  const pbs = await db.select().from(playbooks).where(and(eq(playbooks.cloneId, cloneId), eq(playbooks.status, 'confirmed')));
  const live = (s: string) => s !== 'retired';
  const [mems, trs, rules, answers, scenarios, corr] = await Promise.all([
    db.select().from(memories).where(eq(memories.cloneId, cloneId)),
    db.select().from(traits).where(eq(traits.cloneId, cloneId)),
    db.select().from(contextualRules).where(eq(contextualRules.cloneId, cloneId)),
    db.select().from(interviewAnswers).where(eq(interviewAnswers.cloneId, cloneId)).orderBy(asc(interviewAnswers.createdAt)),
    db.select().from(predictionScenarios).where(and(eq(predictionScenarios.cloneId, cloneId), ne(predictionScenarios.status, 'open'))),
    db.select().from(corrections).where(eq(corrections.cloneId, cloneId)),
  ]);
  const { prompt } = await activePrompt(orgId, cloneId);
  const name = brief?.displayName || clone.name;
  return {
    spec: 'opersona/persona-full@2',
    exportedAt: new Date().toISOString(),
    name,
    brief: brief ? { roleTitle: brief.roleTitle, team: brief.team, briefMd: brief.briefMd, operatingRules: brief.operatingRules } : null,
    fingerprint: patterns.filter((p) => p.status !== 'rejected').sort((a, b) => b.strength - a.strength).map((p) => ({
      key: p.patternKey, dimension: p.dimension, description: p.description, status: p.status, strength: p.strength, seenIn: p.nSources, examples: p.examples,
    })),
    facts: fs.map((f) => ({ statement: f.statement, domain: f.domain, pinned: f.pinned })),
    playbooks: pbs.map((p) => ({ name: p.name, domain: p.domain, trigger: p.trigger, preconditions: p.preconditions, steps: p.steps, pitfalls: p.pitfalls })),
    memories: mems.filter((m) => live(m.status)).map((m) => ({
      summary: m.summary, fullContext: m.fullContext, importance: m.importance, emotionalSignificance: m.emotionalSignificance,
      peopleInvolved: m.peopleInvolved, dateOrPeriod: m.dateOrPeriod, status: m.status, confidence: m.confidence, evidence: m.evidence,
    })),
    traits: trs.filter((t) => live(t.status)).map((t) => ({
      kind: t.kind, key: t.key, label: t.label, statement: t.statement, category: t.category,
      tier: t.tier, strength: t.strength, confidence: t.confidence, status: t.status, evidence: t.evidence,
    })),
    contextualRules: rules.filter((r) => live(r.status)).map((r) => ({
      situation: r.situation, condition: r.condition, tendency: r.tendency, tier: r.tier,
      status: r.status, confidence: r.confidence, evidence: r.evidence,
    })),
    interviewAnswers: answers.map((a) => ({
      category: a.category, question: a.questionText, answer: a.text, skipped: a.skipped,
      revisions: a.revisions, answeredAt: a.createdAt.toISOString(),
    })),
    predictionTests: scenarios.map((s) => ({
      category: s.category, scenario: s.scenario, question: s.question, status: s.status,
      humanAnswer: s.humanAnswer, aiPrediction: s.aiPrediction,
      scores: s.status === 'scored' ? {
        decision: s.scoreDecision, reasoning: s.scoreReasoning, preference: s.scorePreference,
        communication: s.scoreCommunication, calibration: s.scoreCalibration, overall: s.scoreOverall,
      } : null,
      judgeSummary: s.judge?.summary ?? null,
    })),
    corrections: corr.map((x) => ({ kind: x.kind, lesson: x.lesson, humanFix: x.humanFix, standing: x.standing })),
    avatarRecipe: clone.avatarRecipe ?? null,
    systemPrompt: prompt,
  };
}
