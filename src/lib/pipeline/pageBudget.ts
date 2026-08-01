import { bodyChars } from '@/lib/latexText';
import type { DensityModel } from './density';

/**
 * Turning "2 pages" into a character budget.
 *
 * Skillo cannot compile LaTeX, and Overleaf will not report how full a page is
 * (see docs/findings.md), so the budget is built from what compiled page counts
 * have taught us about this template — see `density.ts`. Using the *lower*
 * bound of a page's capacity means the budget cannot ask for more than fits.
 */

/**
 * Used only before anything has been learned about a template. Measured against
 * a real two-page article-class resume: 7288 body characters over 2 pages.
 * Rounded down, because overshooting a page limit is the worse failure.
 */
export const DEFAULT_CHARS_PER_PAGE = 3600;

/**
 * Where inside the learned interval to aim.
 *
 * The lower bound is what a page provably holds, but it is badly pessimistic
 * when the document it came from ended on a half-empty page: a two-page resume
 * whose second page is 40% full proves only `B/2` per page when the truth is
 * nearer `B/1.4`. Aiming at the lower bound therefore asks for far less text
 * than fits, which is what made revisions come out short and made "give me 30%
 * more" impossible to honour.
 *
 * So aim into the interval instead. 0.4 sits just below the midpoint, which on
 * the measured resume lands within ~1% of what actually fitted; filling pushes
 * further up. Anything above the upper bound is known to spill, so we never go
 * there.
 */
const AIM = { normal: 0.4, filling: 0.6 } as const;

/**
 * Applied when a person has told us the real fill. Their reading is good but
 * approximate, and a page limit is worth a little more than the last 3% of a
 * page.
 */
const MEASURED_SAFETY = 0.97;

export interface PageBudget {
  pageLimit: number;
  fillLastPage: boolean;
  /** Best estimate of what one page of this template holds. */
  charsPerPage: number;
  targetChars: number;
  /** Above this it is known to spill, when the upper bound is known. */
  ceilingChars: number | null;
  /** True once real compiled page counts back the numbers. */
  calibrated: boolean;
  /** How many compiles the model rests on. */
  samples: number;
  /** True once a person has reported the real fill for this template. */
  measured: boolean;
}

export { bodyChars, documentBody } from '@/lib/latexText';

export function computePageBudget(
  pageLimit: number,
  fillLastPage: boolean,
  model: DensityModel | null,
): PageBudget {
  if (!model) {
    return {
      pageLimit,
      fillLastPage,
      charsPerPage: DEFAULT_CHARS_PER_PAGE,
      targetChars: DEFAULT_CHARS_PER_PAGE * pageLimit,
      ceilingChars: null,
      calibrated: false,
      samples: 0,
      measured: false,
    };
  }

  const aim = fillLastPage ? AIM.filling : AIM.normal;

  // A reading taken off the real page beats anything inferred from page counts,
  // so it is used directly rather than as one end of an interval.
  const charsPerPage =
    model.estimate !== null
      ? Math.round(model.estimate * MEASURED_SAFETY)
      : model.upper === null
        ? model.lower
        : Math.round(model.lower + (model.upper - model.lower) * aim);

  return {
    pageLimit,
    fillLastPage,
    charsPerPage,
    targetChars: charsPerPage * pageLimit,
    // A measured capacity is its own ceiling: past it, the page is full.
    ceilingChars:
      model.estimate !== null
        ? model.estimate * pageLimit
        : model.upper === null
          ? null
          : model.upper * pageLimit,
    calibrated: true,
    samples: model.samples,
    measured: model.exactSamples > 0,
  };
}

/** What we would tell the user the revision is likely to compile to. */
export function projectedPages(latex: string, budget: PageBudget): number | null {
  if (!budget.calibrated || budget.charsPerPage <= 0) return null;
  return bodyChars(latex) / budget.charsPerPage;
}
