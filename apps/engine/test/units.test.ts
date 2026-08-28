import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/documents/ingest.js';

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
