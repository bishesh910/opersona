import { describe, expect, it } from 'vitest';
import { promptAudience } from '../src/persona/audience.js';

describe('promptAudience — the ?audience= param can only downgrade', () => {
  it('kind defaults with no request', () => {
    expect(promptAudience('member')).toBe('owner');
    expect(promptAudience('hired')).toBe('hired');
    expect(promptAudience('imported')).toBe('imported');
  });

  it('shared is the floor for every kind', () => {
    expect(promptAudience('member', 'shared')).toBe('shared');
    expect(promptAudience('hired', 'shared')).toBe('shared');
    expect(promptAudience('imported', 'shared')).toBe('shared');
  });

  it('visitor strips owner privilege from member clones only', () => {
    expect(promptAudience('member', 'visitor')).toBe('visitor');
    expect(promptAudience('hired', 'visitor')).toBe('hired');
    expect(promptAudience('imported', 'visitor')).toBe('imported');
  });

  it('never widens: requesting owner (or junk) yields the kind default', () => {
    expect(promptAudience('hired', 'owner')).toBe('hired');
    expect(promptAudience('imported', 'owner')).toBe('imported');
    expect(promptAudience('member', 'owner')).toBe('owner'); // already the default, not an escalation
    expect(promptAudience('hired', 'anything-else')).toBe('hired');
    expect(promptAudience('member', null)).toBe('owner');
    expect(promptAudience('member', undefined)).toBe('owner');
  });
});
