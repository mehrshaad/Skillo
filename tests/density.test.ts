import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  getDensityModel,
  learn,
  recordObservation,
  templateKey,
  type DensityObservation,
} from '@/lib/pipeline/density';
import { computePageBudget } from '@/lib/pipeline/pageBudget';
import { validateLatex } from '@/lib/pipeline/validateLatex';

const obs = (bodyChars: number, pages: number): DensityObservation => ({
  bodyChars,
  pages,
  at: '2026-08-01T00:00:00.000Z',
});

const doc = (preamble: string, bodyLength: number) =>
  `\\documentclass{article}${preamble}\\begin{document}${'x'.repeat(bodyLength)}\\end{document}`;

beforeEach(() => {
  fakeBrowser.reset();
});

describe('learn', () => {
  it('returns nothing before anything has been observed', () => {
    expect(learn([])).toBeNull();
  });

  it('derives the bounds a single observation proves', () => {
    // 7288 chars over 2 pages: a page holds at least 3644, and fewer than 7288
    // (or it would have fitted on one).
    const model = learn([obs(7288, 2)])!;
    expect(model.lower).toBe(3644);
    expect(model.upper).toBe(7288);
  });

  it('has no upper bound from a single-page document', () => {
    // Fitting on one page says nothing about where the page ends.
    const model = learn([obs(2000, 1)])!;
    expect(model.lower).toBe(2000);
    expect(model.upper).toBeNull();
  });

  it('narrows the interval as observations accumulate', () => {
    const one = learn([obs(7288, 2)])!;
    const two = learn([obs(7288, 2), obs(7900, 3)])!;

    expect(two.lower).toBeGreaterThanOrEqual(one.lower);
    expect(two.upper!).toBeLessThan(one.upper!);
    expect(two.samples).toBe(2);
  });

  it('keeps the safe bound when observations contradict each other', () => {
    // Restructuring changes height per character, so samples can disagree.
    // The lower bound is the one that must never be overstated.
    const model = learn([obs(9000, 1), obs(4000, 2)])!;
    expect(model.lower).toBe(9000);
    expect(model.upper).toBeNull();
  });

  it('ignores nonsense observations', () => {
    expect(learn([obs(0, 2), obs(-5, 1), obs(100, 0)])).toBeNull();
  });
});

describe('templateKey', () => {
  it('is stable when only the body changes', () => {
    expect(templateKey(doc('\\usepackage{geometry}', 100))).toBe(
      templateKey(doc('\\usepackage{geometry}', 9000)),
    );
  });

  it('changes when the template changes', () => {
    expect(templateKey(doc('\\usepackage{geometry}', 100))).not.toBe(
      templateKey(doc('\\usepackage{times}\\newcommand{\\x}{}', 100)),
    );
  });
});

describe('recording observations', () => {
  it('learns from a compiled page count', async () => {
    const latex = doc('\\usepackage{geometry}', 7288);
    await recordObservation(latex, 2);

    const model = (await getDensityModel(latex))!;
    expect(model.lower).toBe(3644);
    expect(model.samples).toBe(1);
  });

  it('keeps templates separate', async () => {
    const a = doc('\\usepackage{geometry}', 6000);
    const b = doc('\\usepackage{times}', 6000);
    await recordObservation(a, 2);

    expect(await getDensityModel(a)).not.toBeNull();
    expect(await getDensityModel(b)).toBeNull();
  });

  it('does not store the same measurement twice', async () => {
    const latex = doc('\\usepackage{geometry}', 5000);
    await recordObservation(latex, 2);
    await recordObservation(latex, 2);
    expect((await getDensityModel(latex))!.samples).toBe(1);
  });

  it('ignores an unusable page count', async () => {
    const latex = doc('\\usepackage{geometry}', 5000);
    await recordObservation(latex, 0);
    expect(await getDensityModel(latex)).toBeNull();
  });
});

describe('the loop that stops overflow', () => {
  const latex = doc('\\usepackage{geometry}', 7288);

  it('is guaranteed not to ask for more than a page holds', async () => {
    await recordObservation(latex, 2);
    const model = (await getDensityModel(latex))!;
    const budget = computePageBudget(2, false, model);

    // The budget is built from the lower bound, so the requested amount is at
    // most what two pages provably hold.
    expect(budget.targetChars).toBeLessThanOrEqual(7288);
  });

  it('rejects a revision that would overflow, with no grace', async () => {
    await recordObservation(latex, 2);
    const budget = computePageBudget(2, false, (await getDensityModel(latex))!);

    const oneCharOver = doc('\\usepackage{geometry}', budget.targetChars + 1);
    expect(validateLatex(oneCharOver, 7288, budget).problems.join(' ')).toContain(
      'will not fit',
    );

    const exactlyAtBudget = doc('\\usepackage{geometry}', budget.targetChars);
    expect(validateLatex(exactlyAtBudget, 7288, budget).problems).toEqual([]);
  });

  it('tightens after a revision is observed to overflow', async () => {
    await recordObservation(latex, 2);
    const before = computePageBudget(2, false, (await getDensityModel(latex))!);

    // The applied revision compiled to 3 pages: that is new information.
    await recordObservation(doc('\\usepackage{geometry}', 7600), 3);
    const after = computePageBudget(2, false, (await getDensityModel(latex))!);

    // The ceiling came down, so the next attempt is bounded more tightly.
    expect(after.ceilingChars!).toBeLessThan(before.ceilingChars!);
  });

  it('explains itself using the evidence when it rejects', async () => {
    await recordObservation(latex, 2);
    const budget = computePageBudget(1, false, (await getDensityModel(latex))!);
    const problems = validateLatex(doc('\\usepackage{geometry}', 9000), 7288, budget).problems;
    expect(problems.join(' ')).toContain('3644 characters on a page');
  });
});
