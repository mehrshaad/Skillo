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

export interface PageBudget {
  pageLimit: number;
  fillLastPage: boolean;
  charsPerPage: number;
  targetChars: number;
  /** Where the page would actually spill, when the upper bound is known. */
  ceilingChars: number | null;
  /** True once real compiled page counts back the numbers. */
  calibrated: boolean;
  /** How many compiles the model rests on. */
  samples: number;
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
    };
  }

  return {
    pageLimit,
    fillLastPage,
    charsPerPage: model.lower,
    targetChars: model.lower * pageLimit,
    ceilingChars: model.upper === null ? null : model.upper * pageLimit,
    calibrated: true,
    samples: model.samples,
  };
}

/** What we would tell the user the revision is likely to compile to. */
export function projectedPages(latex: string, budget: PageBudget): number | null {
  if (!budget.calibrated || budget.charsPerPage <= 0) return null;
  return bodyChars(latex) / budget.charsPerPage;
}
