import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashText } from '@/lib/hash';
import { assembleSections, parseSections } from '@/lib/latexSections';
import { documentUnchanged } from '@/lib/overleaf/writeGuard';

const RESUME = readFileSync(
  resolve(__dirname, 'fixtures/latex/article-sections.tex'),
  'utf8',
);

/** Hash taken when Skillo read the document out of Overleaf. */
const asReadHash = hashText(RESUME);

describe('overleaf write guard', () => {
  it('allows the write when the document has not moved', () => {
    expect(documentUnchanged(RESUME, asReadHash)).toBe(true);
  });

  it('refuses when the document changed in Overleaf', () => {
    const editedInOverleaf = RESUME.replace('Amsterdam, NL', 'Rotterdam, NL');
    expect(documentUnchanged(editedInOverleaf, asReadHash)).toBe(false);
  });

  it('refuses on even a single character of drift', () => {
    expect(documentUnchanged(RESUME + ' ', asReadHash)).toBe(false);
  });

  // The reason the working-copy hash and the as-read hash are separate fields.
  it('still allows the write after the working copy was restructured locally', () => {
    const doc = parseSections(RESUME)!;
    const reordered = assembleSections({
      ...doc,
      sections: [doc.sections[2]!, doc.sections[0]!, doc.sections[1]!],
    });

    expect(reordered).not.toBe(RESUME);
    // The guard is asked about Overleaf's document, which has not changed.
    expect(documentUnchanged(RESUME, asReadHash)).toBe(true);
    // Hashing the working copy instead would wrongly block the user's own edit.
    expect(documentUnchanged(RESUME, hashText(reordered))).toBe(false);
  });

  it('refuses when the document changed even if we also edited locally', () => {
    const doc = parseSections(RESUME)!;
    const reordered = assembleSections({ ...doc, sections: [...doc.sections].reverse() });
    const editedInOverleaf = RESUME.replace('TU Delft', 'TU Eindhoven');

    expect(reordered).not.toBe(RESUME);
    expect(documentUnchanged(editedInOverleaf, asReadHash)).toBe(false);
  });

  it('refuses when no as-read hash was ever captured', () => {
    // Pasted and uploaded resumes have no Overleaf document behind them.
    expect(documentUnchanged(RESUME, '')).toBe(false);
  });
});
