import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { parseExport, chatgptToTranscript } from '../src/learning/importClaude.js';
import { parseCodexSession, parseClaudeCodeSession, detectSessionFormat } from '../src/learning/claudeCode.js';

// ─── ChatGPT fixture: mapping tree with a branch; current_node picks the active branch ──
const gptMsg = (role: string, parts: unknown[], extra: Record<string, unknown> = {}) =>
  ({ author: { role }, content: { content_type: 'text', parts }, ...extra });
const richGpt = {
  title: 'rich', conversation_id: 'conv-rich', create_time: 1700000000, update_time: 1700003600,
  current_node: 'n6',
  mapping: {
    root: { id: 'root', message: null, parent: null, children: ['n1'] },
    n1: { id: 'n1', message: gptMsg('system', ['system prompt noise']), parent: 'root', children: ['n2'] },
    n2: { id: 'n2', message: gptMsg('user', ['I want to verify the totals myself before trusting the report']), parent: 'n1', children: ['n3a', 'n3b'] },
    // n3a is the ABANDONED branch (a regenerated answer) — must NOT appear in the transcript
    n3a: { id: 'n3a', message: gptMsg('assistant', ['abandoned branch answer']), parent: 'n2', children: [] },
    n3b: { id: 'n3b', message: gptMsg('assistant', ['Sure — here is how to verify them']), parent: 'n2', children: ['n4'] },
    n4: { id: 'n4', message: gptMsg('tool', ['tool output — not a person']), parent: 'n3b', children: ['n5'] },
    n5: {
      id: 'n5',
      message: { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: [{ asset_pointer: 'file-x' }, 'Break it into line items and recompute each one'] } },
      parent: 'n4', children: ['n6'],
    },
    n6: { id: 'n6', message: gptMsg('assistant', ['Recomputed line by line.']), parent: 'n5', children: [] },
  },
};
const thinGpt = {
  title: 'thin', conversation_id: 'conv-thin', create_time: 1700000001, update_time: 1700000002,
  current_node: 'b2',
  mapping: {
    r: { id: 'r', message: null, parent: null, children: ['b1'] },
    b1: { id: 'b1', message: gptMsg('user', ['just one human turn here']), parent: 'r', children: ['b2'] },
    b2: { id: 'b2', message: gptMsg('assistant', ['ok']), parent: 'b1', children: [] },
  },
};

describe('ChatGPT export', () => {
  it('detects the format in parseExport and keeps conversation ids', () => {
    const out = parseExport(Buffer.from(JSON.stringify([richGpt, thinGpt])), 'conversations.json');
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.provider)).toEqual(['chatgpt', 'chatgpt']);
    expect(out.map((c) => c.id)).toEqual(['conv-rich', 'conv-thin']);
  });
  it('detects the format inside the export zip too', () => {
    const z = new AdmZip();
    z.addFile('conversations.json', Buffer.from(JSON.stringify([richGpt])));
    z.addFile('user.json', Buffer.from('{}'));
    z.addFile('chat.html', Buffer.from('<html></html>'));
    const out = parseExport(z.toBuffer(), 'chatgpt-export.zip');
    expect(out).toHaveLength(1);
    expect(out[0]!.provider).toBe('chatgpt');
  });
  it('walks the active branch only, skips system/tool/hidden, keeps string parts of multimodal', () => {
    const t = chatgptToTranscript(richGpt);
    expect(t.map((x) => x.role)).toEqual(['human', 'assistant', 'human', 'assistant']);
    expect(t[0]!.text).toBe('I want to verify the totals myself before trusting the report');
    expect(t[1]!.text).toBe('Sure — here is how to verify them');           // n3a (abandoned branch) absent
    expect(t[2]!.text).toBe('Break it into line items and recompute each one'); // non-string part dropped
    const all = t.map((x) => x.text).join('\n');
    expect(all).not.toContain('abandoned branch');
    expect(all).not.toContain('system prompt');
    expect(all).not.toContain('tool output');
  });
  it('a 1-human-turn conversation parses but stays under the import threshold', () => {
    const t = chatgptToTranscript(thinGpt);
    expect(t.filter((x) => x.role === 'human')).toHaveLength(1); // runImport skips <2 human turns
  });
});

// ─── Codex CLI rollout fixture ──────────────────────────────────────────────
const codexLines = [
  { type: 'session_meta', payload: { id: 'codex-sess-1', cwd: '/home/dev/proj', originator: 'codex_cli_rs' } },
  { type: 'turn_context', payload: { model: 'gpt-5' } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<user_instructions>\nalways be terse\n</user_instructions>' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\ncwd: /home/dev/proj\n</environment_context>' }] } },
  { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Show me the failing test output first, then we decide' }] } },
  { type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'private reasoning' }] } },
  { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["npm","test"]}', call_id: 'c1' } },
  { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'FAIL 3 tests' } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Three tests fail, all in parser.ts.' }] } },
  { type: 'event_msg', payload: { type: 'user_message', message: 'Show me the failing test output first, then we decide' } }, // dup of the response_item above
  { type: 'event_msg', payload: { type: 'user_message', message: 'Fix only the first one, I want to re-run after each change' } },
  { type: 'something_unknown', payload: { whatever: true } },
  'not json at all',
].map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n');

describe('Codex CLI sessions', () => {
  it('parses meta, filters wrapper noise, dedupes the doubled user message, summarises tool calls', () => {
    const p = parseCodexSession(codexLines);
    expect(p.sessionId).toBe('codex-sess-1');
    expect(p.cwd).toBe('/home/dev/proj');
    expect(p.humanTurns).toBe(2);
    expect(p.transcript.map((t) => t.role)).toEqual(['human', 'assistant', 'human']);
    expect(p.transcript[0]!.text).toBe('Show me the failing test output first, then we decide');
    expect(p.transcript[1]!.text).toContain('[used shell: {"command":["npm","test"]}]');
    expect(p.transcript[1]!.text).toContain('Three tests fail');
    expect(p.transcript[2]!.text).toBe('Fix only the first one, I want to re-run after each change');
    const all = p.transcript.map((t) => t.text).join('\n');
    expect(all).not.toContain('user_instructions');
    expect(all).not.toContain('environment_context');
    expect(all).not.toContain('private reasoning');
    expect(all).not.toContain('FAIL 3 tests'); // tool OUTPUT is never ingested
  });
  it('detectSessionFormat tells Codex and Claude Code apart', () => {
    expect(detectSessionFormat(codexLines)).toBe('codex');
    const cc = [
      { type: 'summary', summary: 'a chat' },
      { type: 'user', sessionId: 'cc-1', cwd: '/x', message: { role: 'user', content: 'hello there, look at this' } },
      { type: 'assistant', sessionId: 'cc-1', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    ].map((l) => JSON.stringify(l)).join('\n');
    expect(detectSessionFormat(cc)).toBe('claude-code');
    const p = parseClaudeCodeSession(cc);
    expect(p.sessionId).toBe('cc-1');
    expect(p.humanTurns).toBe(1);
  });
});
