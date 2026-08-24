import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import { parseExport, toTranscript } from '../src/learning/importClaude.js';
const conv = (u: string) => ({ uuid: u, name: 'n', chat_messages: [{ sender: 'human' as const, text: 'hi there friend' }, { sender: 'assistant' as const, content: [{ type: 'text', text: 'hello' }] }] });
describe('parseExport', () => {
  it('official zip with conversations.json', () => { const z = new AdmZip(); z.addFile('conversations.json', Buffer.from(JSON.stringify([conv('a'), conv('b')]))); z.addFile('users.json', Buffer.from('[]')); expect(parseExport(z.toBuffer(), 'x.zip')).toHaveLength(2); });
  it('bare array / single object', () => { expect(parseExport(Buffer.from(JSON.stringify([conv('a')])), 'all.json')).toHaveLength(1); expect(parseExport(Buffer.from(JSON.stringify(conv('a'))), 'one.json')).toHaveLength(1); });
  it('extension bulk zip: one json per conversation + summary', () => { const z = new AdmZip(); z.addFile('Chat one.json', Buffer.from(JSON.stringify(conv('a')))); z.addFile('Chat two.json', Buffer.from(JSON.stringify(conv('b')))); z.addFile('export_summary.json', Buffer.from('{"failed":[]}')); expect(parseExport(z.toBuffer(), 'claude-conversations.zip')).toHaveLength(2); });
  it('manifest → explanatory error', () => { expect(() => parseExport(Buffer.from(JSON.stringify({ data_files: [{ category: 'conversations', filename: 'conversations-000.zip', export_url: 'x' }] })), 'manifest.json')).toThrow(/conversations-000\.zip/); });
  it('toTranscript reads text or content blocks', () => { expect(toTranscript(conv('a')).map((t) => t.text)).toEqual(['hi there friend', 'hello']); });
});
