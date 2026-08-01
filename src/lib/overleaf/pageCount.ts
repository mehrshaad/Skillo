/**
 * Reads how many pages the compiled PDF has.
 *
 * Verified against a live Overleaf project: the preview is PDF.js, which renders
 * one `.page` element per page inside `.pdfViewer`, each carrying
 * `data-page-number`. There is no "N of M" text indicator in this build, so the
 * page elements are the signal. PDF.js virtualizes canvases but keeps a
 * placeholder element for every page, so taking the highest page number is more
 * reliable than counting rendered canvases.
 *
 * Unlike the editor bridge this needs no page JavaScript, so it runs in the
 * ISOLATED content script directly.
 */

/** Tolerant list, first that matches anything wins. Overleaf renames wrappers. */
const PAGE_SELECTORS = [
  '.pdf-viewer .page[data-page-number]',
  '.pdfViewer .page[data-page-number]',
  '.page[data-page-number]',
] as const;

export function readPageCount(doc: Document): number | null {
  for (const selector of PAGE_SELECTORS) {
    const pages = doc.querySelectorAll(selector);
    if (pages.length === 0) continue;

    let highest = 0;
    for (const page of Array.from(pages)) {
      const value = Number(page.getAttribute('data-page-number'));
      if (Number.isFinite(value) && value > highest) highest = value;
    }
    if (highest > 0) return highest;
  }

  // Not compiled yet, PDF pane closed, or Overleaf changed the viewer. The
  // caller falls back to an estimate; never guess a number here.
  return null;
}
