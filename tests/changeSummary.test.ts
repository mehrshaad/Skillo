import { describe, expect, it } from 'vitest';
import { parseBullets } from '@/core/changeSummary';

describe('parseBullets', () => {
  it('splits a dash list', () => {
    expect(parseBullets('- Reordered skills\n- Cut the retail bullet')).toEqual([
      'Reordered skills',
      'Cut the retail bullet',
    ]);
  });

  it('handles the other bullet characters models reach for', () => {
    expect(parseBullets('* One\n• Two\n1. Three\n2) Four')).toEqual([
      'One',
      'Two',
      'Three',
      'Four',
    ]);
  });

  it('joins a wrapped bullet back onto its own line', () => {
    const summary = `- Rewrote the summary to lead with platform work,
  because the posting opens with it
- Cut the retail role`;
    expect(parseBullets(summary)).toEqual([
      'Rewrote the summary to lead with platform work, because the posting opens with it',
      'Cut the retail role',
    ]);
  });

  it('ignores blank lines between bullets', () => {
    expect(parseBullets('- One\n\n\n- Two')).toEqual(['One', 'Two']);
  });

  it('returns nothing for prose, so the caller can fall back', () => {
    expect(parseBullets('I reordered a few things and cut some others.')).toEqual([]);
  });

  it('returns nothing for an empty summary', () => {
    expect(parseBullets('   \n  ')).toEqual([]);
  });

  it('does not mistake a hyphenated sentence for a bullet', () => {
    // No space after the dash, so it is not a list marker.
    expect(parseBullets('-not a bullet')).toEqual([]);
  });
});
