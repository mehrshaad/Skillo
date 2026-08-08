import { describe, expect, it } from 'vitest';
import { hashText } from '@/core/hash';

describe('hashText', () => {
  it('is stable for identical input', () => {
    expect(hashText('\\documentclass{article}')).toBe(hashText('\\documentclass{article}'));
  });

  it('changes when a single character changes', () => {
    expect(hashText('Senior Engineer')).not.toBe(hashText('Senior Engineerr'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
  });

  it('encodes length so same-length edits cannot collide silently', () => {
    expect(hashText('hello')).toMatch(/-5$/);
    expect(hashText('')).toMatch(/-0$/);
  });
});
