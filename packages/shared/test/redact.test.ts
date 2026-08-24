import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/redact.js';

describe('redactSecrets', () => {
  it('strips provider keys, JWTs and key=value secrets but keeps prose', () => {
    const s = redactSecrets('token: sk-ant-abcdefghijklmnopqrstuvwxyz0123 and jwt eyJabcdef.eyJabcdef.sigsigsig; path /var/ossec/logs/ossec.log; password=hunter2222');
    expect(s).not.toContain('sk-ant-');
    expect(s).not.toContain('eyJ');
    expect(s).toContain('/var/ossec/logs/ossec.log');
    expect(s).toContain('password=[redacted]');
  });
  it('returns empty string for non-strings', () => { expect(redactSecrets(null)).toBe(''); });
});
