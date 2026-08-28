import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/llm.js', () => ({ structuredCall: vi.fn(), textCall: vi.fn() }));
vi.mock('../src/keys.js', () => ({ orgModelConfig: vi.fn(async () => ({ apiKey: 'k', chatModel: 'c', extractModel: 'e', condenseModel: 'h' })) }));
vi.mock('../src/interview/state.js', () => ({ knownDigest: vi.fn(async () => '(nothing known yet)') }));

import { structuredCall } from '../src/llm.js';
import { triageAnswer, TRIAGE_TIMEOUT_MS } from '../src/interview/triage.js';

const args = { orgId: 'o', cloneId: 'c', questionText: 'Q?', answerText: 'A.' };

describe('triageAnswer — the interview never stalls', () => {
  beforeEach(() => { delete process.env.INTERVIEW_TRIAGE; });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); delete process.env.INTERVIEW_TRIAGE; });

  it('returns the triage result when the model answers in time', async () => {
    vi.mocked(structuredCall).mockResolvedValueOnce({ quality: 'substantive', ack: 'Heard.', followups: [], tension: null });
    const r = await triageAnswer(args);
    expect(r?.ack).toBe('Heard.');
  });

  it('returns null when the model call hangs past the ceiling', async () => {
    vi.useFakeTimers();
    vi.mocked(structuredCall).mockImplementationOnce(() => new Promise(() => {})); // never resolves
    const p = triageAnswer(args);
    await vi.advanceTimersByTimeAsync(TRIAGE_TIMEOUT_MS + 1);
    expect(await p).toBeNull();
  });

  it('returns null on a rail error instead of throwing', async () => {
    vi.mocked(structuredCall).mockRejectedValueOnce(new Error('no_api_key: nothing configured'));
    expect(await triageAnswer(args)).toBeNull();
  });

  it('INTERVIEW_TRIAGE=false disables it without touching the model', async () => {
    process.env.INTERVIEW_TRIAGE = 'false';
    const calls = vi.mocked(structuredCall).mock.calls.length;
    expect(await triageAnswer(args)).toBeNull();
    expect(vi.mocked(structuredCall).mock.calls.length).toBe(calls);
  });
});
