/**
 * Skillo cannot compile LaTeX, so page count is approached in three layers:
 * a character budget steers the model, a validator rejects output that is
 * obviously the wrong size, and after applying we read the real page count out
 * of Overleaf's compiled PDF view.
 *
 * This file is layer one: turning "2 pages" into a character budget.
 */

/**
 * Used only when Overleaf has not told us the real page count. Measured against
 * a real two-page article-class resume: 7288 body characters over 2 pages, so
 * ~3644. Rounded down slightly because overshooting the budget is the more
 * annoying failure. Templates vary a lot, which is why an estimated budget is
 * validated far more loosely than a calibrated one.
 */
export const DEFAULT_CHARS_PER_PAGE = 3600;

export interface PageBudget {
  pageLimit: number;
  fillLastPage: boolean;
  charsPerPage: number;
  targetChars: number;
  /** True when charsPerPage came from this resume's real page count. */
  calibrated: boolean;
}

/** Characters between \begin{document} and \end{document}; the preamble does not print. */
export function bodyChars(latex: string): number {
  return documentBody(latex).length;
}

export function documentBody(latex: string): string {
  const start = latex.indexOf('\\begin{document}');
  const end = latex.lastIndexOf('\\end{document}');
  if (start === -1 || end === -1 || end <= start) return latex;
  return latex.slice(start + '\\begin{document}'.length, end);
}

export function computePageBudget(
  originalLatex: string,
  pageLimit: number,
  fillLastPage: boolean,
  knownPages: number | null,
): PageBudget {
  const body = bodyChars(originalLatex);
  const calibrated = knownPages !== null && knownPages > 0 && body > 0;
  const charsPerPage = calibrated ? Math.round(body / knownPages) : DEFAULT_CHARS_PER_PAGE;

  return {
    pageLimit,
    fillLastPage,
    charsPerPage,
    targetChars: charsPerPage * pageLimit,
    calibrated,
  };
}
