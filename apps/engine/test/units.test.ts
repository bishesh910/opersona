import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/documents/ingest.js';
import { publish, subscribe } from '../src/sessions/events.js';

describe('chunkText', () => {
  it('splits long text with overlap and drops empties', () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i} of the wazuh notes`).join('\n');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1200);
    // overlap: the start of chunk 2 appears near the end of chunk 1
    expect(chunks[0]!.slice(-150)).toContain(chunks[1]!.slice(0, 40));
    expect(chunkText('   \n\n ')).toEqual([]);
  });
});

describe('event bus', () => {
  it('replays the ring buffer after Last-Event-ID and delivers live events', () => {
    const conv = 'conv-test-' + Math.random();
    publish(conv, { type: 'text_delta', text: 'a' });
    publish(conv, { type: 'text_delta', text: 'b' });
    const got: string[] = [];
    const unsub = subscribe(conv, (s) => got.push(`${s.id}:${(s.ev as { text: string }).text}`), 1);
    publish(conv, { type: 'text_delta', text: 'c' });
    unsub();
    publish(conv, { type: 'text_delta', text: 'd' });
    expect(got).toEqual(['2:b', '3:c']);
  });
});

describe('InputQueue', () => {
  it('delivers pushed items in order and ends on close', async () => {
    const { InputQueue } = await import('../src/sessions/manager.js');
    const q = new InputQueue();
    const msg = (t: string) => ({ type: 'user' as const, message: { role: 'user' as const, content: t }, parent_tool_use_id: null });
    const out: string[] = [];
    const consumer = (async () => { for await (const m of q) out.push(m.message.content as string); })();
    q.push(msg('one')); q.push(msg('two'));
    await new Promise((r) => setTimeout(r, 10));
    q.push(msg('three')); q.close();
    await consumer;
    expect(out).toEqual(['one', 'two', 'three']);
  });
});
