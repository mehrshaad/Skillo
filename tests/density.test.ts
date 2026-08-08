import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { learn, templateKey, type DensityObservation } from '@/core/pipeline/density';
import { getDensityModel, recordObservation } from '@/lib/pipeline/densityStore';
import { computePageBudget } from '@/core/pipeline/pageBudget';
import { validateLatex } from '@/core/pipeline/validateLatex';

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

describe('a fill the user reported', () => {
  const preamble = '\\usepackage{geometry}';
  const latex = doc(preamble, 7288);

  it('pins the capacity instead of bounding it', () => {
    // "This came out to about 1.4 pages" says a page holds 7288 / 1.4.
    const model = learn([{ ...obs(7288, 1.4), exact: true }])!;
    expect(model.estimate).toBe(5206);
    expect(model.exactSamples).toBe(1);
  });

  it('replaces the inferred figure with the measured one', async () => {
    await recordObservation(latex, 2);
    const counted = computePageBudget(1, false, (await getDensityModel(latex))!);
    expect(counted.measured).toBe(false);

    // "It came out to about 1.4 pages" ⇒ a page holds 7288 / 1.4 ≈ 5206.
    await recordObservation(latex, 1.4, true);
    const reported = computePageBudget(1, false, (await getDensityModel(latex))!);

    expect(reported.measured).toBe(true);
    expect(reported.charsPerPage).toBe(Math.round(5206 * 0.97));
  });

  it('takes the median of several readings, so one careless drag does not win', () => {
    const model = learn([
      { ...obs(6000, 1.0), exact: true },
      { ...obs(6000, 1.2), exact: true },
      { ...obs(6000, 3.0), exact: true },
    ])!;
    expect(model.estimate).toBe(5000); // 6000 / 1.2
  });

  it('accepts a fraction below one page, which a page count never could', async () => {
    await recordObservation(latex, 0.6, true);
    expect((await getDensityModel(latex))!.estimate).toBe(Math.round(7288 / 0.6));
  });

  it('still refuses a nonsensical reading', async () => {
    await recordObservation(latex, 0, true);
    expect(await getDensityModel(latex)).toBeNull();
  });

  it('overrides the counted bounds once it exists', () => {
    const model = learn([obs(7288, 2), { ...obs(7288, 1.4), exact: true }])!;
    expect(model.lower).toBe(3644); // the counted bound is still there
    expect(model.estimate).toBe(5206); // but the reading is what gets used
    expect(computePageBudget(1, false, model).charsPerPage).toBe(Math.round(5206 * 0.97));
  });
});

describe('budgeting from what was learned', () => {
  const preamble = '\\usepackage{geometry}';
  const latex = doc(preamble, 7288);

  it('asks for far more than the floor, because the floor is pessimistic', async () => {
    // A two-page document whose second page is half empty only proves B/2 per
    // page. Aiming there would ask for roughly half what actually fits.
    await recordObservation(latex, 2);
    const budget = computePageBudget(1, false, (await getDensityModel(latex))!);

    expect(budget.charsPerPage).toBeGreaterThan(3644);
    expect(budget.charsPerPage).toBeLessThan(7288);
  });

  it('does not reject a revision that might still fit', async () => {
    await recordObservation(latex, 2);
    const budget = computePageBudget(1, false, (await getDensityModel(latex))!);

    // Above the target but below the size this template was seen to spill at:
    // genuinely unknown, so it must not be failed. Rejecting here is what made
    // revisions come back short.
    const optimistic = doc(preamble, budget.targetChars + 500);
    expect(validateLatex(optimistic, 7288, budget).problems).toEqual([]);
  });

  it('does reject a revision known to overflow', async () => {
    await recordObservation(latex, 2);
    const budget = computePageBudget(1, false, (await getDensityModel(latex))!);

    const tooBig = doc(preamble, budget.ceilingChars! + 1);
    expect(validateLatex(tooBig, 7288, budget).problems.join(' ')).toContain('will not fit');
  });

  it('tightens after a revision is observed to overflow', async () => {
    await recordObservation(latex, 2);
    const before = computePageBudget(2, false, (await getDensityModel(latex))!);

    // The applied revision compiled to 3 pages: new information.
    await recordObservation(doc(preamble, 7600), 3);
    const after = computePageBudget(2, false, (await getDensityModel(latex))!);

    expect(after.ceilingChars!).toBeLessThan(before.ceilingChars!);
    expect(after.charsPerPage).toBeLessThan(before.charsPerPage);
  });

  it('cites the size it was seen to spill at when it rejects', async () => {
    await recordObservation(latex, 2);
    const budget = computePageBudget(1, false, (await getDensityModel(latex))!);
    const problems = validateLatex(doc(preamble, 99000), 7288, budget).problems;
    expect(problems.join(' ')).toContain('seen to spill past');
  });
});
