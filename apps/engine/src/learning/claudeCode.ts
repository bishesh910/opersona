/**
 * Coding-session transcripts (Claude Code or Codex CLI) → reasoning observations.
 *
 * Claude Code writes one JSONL per session under ~/.claude/projects/<encoded-cwd>/<id>.jsonl;
 * Codex CLI (OpenAI) writes one under ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
 * We turn it into the same human/assistant transcript the extractor already understands:
 *  - HUMAN turns: the person's typed prompts (not tool results, not slash-command noise,
 *    not system reminders). This is where the reasoning moves live.
 *  - ASSISTANT turns: Claude's visible text, plus a one-line summary of each tool call
 *    ("[ran Bash: npm test]") so the extractor can see what the human was reacting to.
 *    Thinking blocks and tool OUTPUT are dropped — they are not the person.
 *
 * Sources: the SessionEnd hook (remote ingest token) or a transcript upload.
 */
import { and, eq } from 'drizzle-orm';
import { db, claudeCodeSessions, reasoningObservations } from '@opersona/db';
import { extractFromTranscript, type TranscriptTurn } from './extractReasoning.js';
import { recomputeFingerprint } from './fingerprint.js';
import { publishSnapshot } from '../persona/assemble.js';

interface Block { type: string; text?: string; name?: string; input?: Record<string, unknown>; content?: unknown }
interface Line { type?: string; isSidechain?: boolean; sessionId?: string; cwd?: string; message?: { role?: string; content?: string | Block[] } }

const NOISE = /^\s*(<local-command-caveat>|<local-command-stdout>|<command-name>|<command-message>|<system-reminder>|<task-notification>|<cross-session-message|\[SYSTEM NOTIFICATION|\[Request interrupted|\[Cross-session)/;

function toolSummary(b: Block): string {
  const i = b.input ?? {};
  const pick = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : '');
  const detail = pick('command') || pick('file_path') || pick('pattern') || pick('query') || pick('description') || pick('prompt') || '';
  return `[used ${b.name ?? 'tool'}${detail ? `: ${detail.slice(0, 160).replace(/\s+/g, ' ')}` : ''}]`;
}

export function parseClaudeCodeSession(jsonl: string): { sessionId: string | null; cwd: string | null; transcript: TranscriptTurn[]; humanTurns: number } {
  let sessionId: string | null = null, cwd: string | null = null;
  const out: TranscriptTurn[] = [];
  for (const raw of jsonl.split('\n')) {
    if (!raw.trim()) continue;
    let d: Line; try { d = JSON.parse(raw) as Line; } catch { continue; }
    if (!sessionId && d.sessionId) sessionId = d.sessionId;
    if (!cwd && d.cwd) cwd = d.cwd;
    if (d.isSidechain) continue; // subagent traffic is not the person
    if (d.type !== 'user' && d.type !== 'assistant') continue;
    const m = d.message; if (!m) continue;
    if (d.type === 'user') {
      let text = '';
      if (typeof m.content === 'string') text = m.content;
      else if (Array.isArray(m.content)) text = m.content.filter((b) => b.type === 'text' && b.text).map((b) => b.text!).join('\n');
      text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
      if (!text || NOISE.test(text)) continue;
      out.push({ role: 'human', text });
    } else if (Array.isArray(m.content)) {
      const parts: string[] = [];
      for (const b of m.content) {
        if (b.type === 'text' && b.text?.trim()) parts.push(b.text.trim());
        else if (b.type === 'tool_use') parts.push(toolSummary(b));
      }
      const text = parts.join('\n');
      if (!text) continue;
      // merge consecutive assistant fragments (one turn = many API messages in Claude Code)
      const last = out[out.length - 1];
      if (last && last.role === 'assistant') last.text += '\n' + text; else out.push({ role: 'assistant', text });
    }
  }
  return { sessionId, cwd, transcript: out, humanTurns: out.filter((t) => t.role === 'human').length };
}

// ─── Codex CLI sessions (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) ──────
interface CodexPayload {
  id?: string; cwd?: string; type?: string; role?: string; name?: string; arguments?: unknown;
  message?: string; content?: { type?: string; text?: string }[]; action?: { command?: unknown };
}
interface CodexLine { type?: string; payload?: CodexPayload }

/** Codex records its instruction/environment wrappers as synthetic "user" messages — not the person. */
const CODEX_NOISE = /^\s*(<(user_instructions|environment_context|ENVIRONMENT|INSTRUCTIONS)\b|#\s*AGENTS\.md)/i;

/** Same output shape as parseClaudeCodeSession so both feed the same ingest path. */
export function parseCodexSession(jsonl: string): { sessionId: string | null; cwd: string | null; transcript: TranscriptTurn[]; humanTurns: number } {
  let sessionId: string | null = null, cwd: string | null = null;
  const out: TranscriptTurn[] = [];
  const pushHuman = (raw: string) => {
    const text = raw.trim();
    if (!text || CODEX_NOISE.test(text)) return;
    // Some Codex versions record the same user message twice (response_item + event_msg): keep one.
    for (let i = out.length - 1; i >= 0; i--) if (out[i]!.role === 'human') { if (out[i]!.text === text) return; break; }
    out.push({ role: 'human', text });
  };
  const pushAssistant = (text: string) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.role === 'assistant') last.text += '\n' + text; else out.push({ role: 'assistant', text });
  };
  for (const raw of jsonl.split('\n')) {
    if (!raw.trim()) continue;
    let d: CodexLine; try { d = JSON.parse(raw) as CodexLine; } catch { continue; }
    const p = d.payload ?? {};
    if (d.type === 'session_meta') {
      if (!sessionId && typeof p.id === 'string') sessionId = p.id;
      if (!cwd && typeof p.cwd === 'string') cwd = p.cwd;
    } else if (d.type === 'response_item') {
      if (p.type === 'message' && Array.isArray(p.content)) {
        const text = p.content.filter((b) => b && (b.type === 'input_text' || b.type === 'output_text' || b.type === 'text') && typeof b.text === 'string').map((b) => b.text!).join('\n');
        if (p.role === 'user') pushHuman(text);
        else if (p.role === 'assistant') pushAssistant(text.trim());
      } else if (p.type === 'function_call') {
        const args = typeof p.arguments === 'string' ? p.arguments : p.arguments != null ? JSON.stringify(p.arguments) : '';
        pushAssistant(`[used ${p.name ?? 'tool'}${args ? `: ${args.slice(0, 160).replace(/\s+/g, ' ')}` : ''}]`);
      } else if (p.type === 'local_shell_call') {
        const cmd = Array.isArray(p.action?.command) ? (p.action!.command as unknown[]).filter((x) => typeof x === 'string').join(' ') : '';
        pushAssistant(`[used shell${cmd ? `: ${cmd.slice(0, 160).replace(/\s+/g, ' ')}` : ''}]`);
      } // reasoning / function_call_output / unknown item types: skip
    } else if (d.type === 'event_msg' && p.type === 'user_message' && typeof p.message === 'string') {
      pushHuman(p.message);
    } // unknown line types: skip (be liberal in what we accept)
  }
  return { sessionId, cwd, transcript: out, humanTurns: out.filter((t) => t.role === 'human').length };
}

export type SessionFormat = 'claude-code' | 'codex';

/** Sniff which CLI wrote a .jsonl transcript: Claude Code lines carry sessionId+message;
 *  Codex lines are {type, payload} envelopes. Defaults to claude-code (the historical behaviour). */
export function detectSessionFormat(jsonl: string): SessionFormat {
  const CODEX_TYPES = new Set(['session_meta', 'response_item', 'event_msg', 'turn_context', 'compacted']);
  let checked = 0;
  for (const raw of jsonl.split('\n')) {
    if (!raw.trim() || checked++ > 50) continue;
    let d: Record<string, unknown>; try { d = JSON.parse(raw) as Record<string, unknown>; } catch { continue; }
    if (!d || typeof d !== 'object') continue;
    if ('sessionId' in d && 'message' in d) return 'claude-code';
    if (typeof d.type === 'string' && ('payload' in d || CODEX_TYPES.has(d.type))) return 'codex';
  }
  return 'claude-code';
}

const MAX_TRANSCRIPT_BYTES = 6 * 1024 * 1024;

/** A session transcript that outgrew the cap is learned from its newest tail (cut at a line boundary):
 *  the extractor's evidence stays intact and re-learns of ever-growing sessions stop re-chewing megabytes. */
export function tailTranscript(jsonl: string): string {
  if (jsonl.length <= MAX_TRANSCRIPT_BYTES) return jsonl;
  // keep the head line (session meta often lives there), then the newest tail
  const headEnd = jsonl.indexOf('\n');
  const head = headEnd > 0 ? jsonl.slice(0, headEnd + 1) : '';
  let tail = jsonl.slice(-MAX_TRANSCRIPT_BYTES);
  const firstBreak = tail.indexOf('\n');
  if (firstBreak >= 0) tail = tail.slice(firstBreak + 1); // drop the partial first line
  return head + tail;
}

export type IngestResult = { status: 'done' | 'skipped' | 'failed'; sessionId: string | null; observations: number; note: string };

/** Learn from one coding-session transcript, Claude Code or Codex (idempotent per clone+session).
 *  Format is auto-detected per file unless passed explicitly. */
export async function ingestClaudeCodeSession(args: { orgId: string; cloneId: string; jsonl: string; source: 'local' | 'hook' | 'upload'; sessionIdHint?: string; project?: string; format?: SessionFormat }): Promise<IngestResult> {
  const format = args.format ?? detectSessionFormat(args.jsonl);
  const sourcePrefix = format === 'codex' ? 'codex' : 'claude-code';
  const capped = tailTranscript(args.jsonl);
  const parsed = format === 'codex' ? parseCodexSession(capped) : parseClaudeCodeSession(capped);
  const sessionId = parsed.sessionId ?? args.sessionIdHint ?? null;
  if (!sessionId) return { status: 'failed', sessionId: null, observations: 0, note: 'no session id in transcript' };
  const [seen] = await db.select({ status: claudeCodeSessions.status, bytes: claudeCodeSessions.bytes }).from(claudeCodeSessions)
    .where(and(eq(claudeCodeSessions.cloneId, args.cloneId), eq(claudeCodeSessions.sessionId, sessionId))).limit(1);
  // A session that has grown substantially since we learned from it (resumed / long-running)
  // is re-learned from scratch: old observations for it are replaced, never double-counted.
  const grown = seen && seen.status === 'done' && args.jsonl.length > seen.bytes * 1.15 && args.jsonl.length - seen.bytes > 100_000;
  if (seen && seen.status !== 'failed' && !grown) return { status: 'skipped', sessionId, observations: 0, note: 'already learned from this session' };
  if (grown) await db.delete(reasoningObservations).where(and(eq(reasoningObservations.cloneId, args.cloneId), eq(reasoningObservations.sourceRef, `${sourcePrefix}:${sessionId}`)));

  const humanChars = parsed.transcript.filter((t) => t.role === 'human').reduce((n, t) => n + t.text.length, 0);
  const base = { orgId: args.orgId, cloneId: args.cloneId, sessionId, source: args.source, project: args.project ?? parsed.cwd ?? null, bytes: args.jsonl.length, humanTurns: parsed.humanTurns };
  if (parsed.humanTurns < 2 || humanChars < 200) {
    await db.insert(claudeCodeSessions).values({ ...base, status: 'skipped', note: 'too little human input to learn from', extractedAt: new Date() }).onConflictDoNothing();
    return { status: 'skipped', sessionId, observations: 0, note: 'too little human input to learn from' };
  }
  await db.insert(claudeCodeSessions).values({ ...base, status: 'queued' }).onConflictDoUpdate({ target: [claudeCodeSessions.cloneId, claudeCodeSessions.sessionId], set: { status: 'queued', bytes: base.bytes, humanTurns: base.humanTurns } });
  try {
    const out = await extractFromTranscript({ orgId: args.orgId, cloneId: args.cloneId, transcript: parsed.transcript, sourceKind: 'import', sourceRef: `${sourcePrefix}:${sessionId}` });
    await db.update(claudeCodeSessions).set({ status: 'done', observations: out.observations.length, note: out.note, extractedAt: new Date() })
      .where(and(eq(claudeCodeSessions.cloneId, args.cloneId), eq(claudeCodeSessions.sessionId, sessionId)));
    await recomputeFingerprint(args.orgId, args.cloneId);
    await publishSnapshot(args.orgId, args.cloneId);
    return { status: 'done', sessionId, observations: out.observations.length, note: out.note };
  } catch (e) {
    const note = e instanceof Error ? e.message : String(e);
    await db.update(claudeCodeSessions).set({ status: 'failed', note }).where(and(eq(claudeCodeSessions.cloneId, args.cloneId), eq(claudeCodeSessions.sessionId, sessionId)));
    return { status: 'failed', sessionId, observations: 0, note };
  }
}
