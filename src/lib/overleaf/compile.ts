/**
 * Recompiling, and getting the PDF out.
 *
 * All verified against a live project rather than guessed (see
 * docs/findings.md). The button is `.compile-button` inside
 * `.compile-button-group`; it carries `data-ol-loading`, which flips
 * false → true → false across a compile and is what lets us wait for the real
 * end of one instead of sleeping and hoping.
 *
 * The PDF is not fetched. Overleaf's own download link is clicked, because the
 * output URL is signed and only the page's session can use it — constructing
 * and fetching it ourselves is exactly the trap that finding warns about.
 *
 * This is ordinary DOM, so unlike the editor bridge it needs no page
 * JavaScript and runs in the ISOLATED content script.
 */

/** Tolerant list, first match wins. Overleaf renames classes often. */
const COMPILE_BUTTON_SELECTORS = [
  '.compile-button-group button.compile-button',
  'button.compile-button',
] as const;

const PDF_LINK_SELECTORS = [
  'a[download][href*="/output/output.pdf"]',
  'a[aria-label="Download PDF"]',
  'a[aria-label="Download as PDF"]',
] as const;

const POLL_MS = 200;
/** How long to wait for a compile to visibly begin before assuming it will not. */
const START_TIMEOUT_MS = 3_000;
/** A big document on a busy server is slow; well past that is a hang. */
const FINISH_TIMEOUT_MS = 180_000;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pick<T extends Element>(doc: Document, selectors: readonly string[]): T | null {
  for (const selector of selectors) {
    const el = doc.querySelector<T>(selector);
    if (el) return el;
  }
  return null;
}

function findCompileButton(doc: Document): HTMLButtonElement | null {
  const bySelector = pick<HTMLButtonElement>(doc, COMPILE_BUTTON_SELECTORS);
  if (bySelector) return bySelector;

  // Last resort: the label. Cheap, and survives a class rename.
  return (
    Array.from(doc.querySelectorAll('button')).find((b) =>
      /recompile/i.test(b.textContent ?? ''),
    ) ?? null
  );
}

const isBusy = (button: HTMLButtonElement) =>
  button.dataset.olLoading === 'true' || button.disabled;

export type CompileOutcome = 'compiled' | 'no-button' | 'timeout';

export async function recompile(doc: Document): Promise<CompileOutcome> {
  const button = findCompileButton(doc);
  if (!button) return 'no-button';

  // A compile already running is the one we should wait for, not a second one.
  if (!isBusy(button)) button.click();

  // Give it a moment to start. If it never does, Overleaf decided there was
  // nothing to rebuild, which is a success from the caller's point of view.
  let started = false;
  for (let waited = 0; waited < START_TIMEOUT_MS; waited += POLL_MS) {
    if (isBusy(button)) {
      started = true;
      break;
    }
    await delay(POLL_MS);
  }
  if (!started) return 'compiled';

  for (let waited = 0; waited < FINISH_TIMEOUT_MS; waited += POLL_MS) {
    await delay(POLL_MS);
    if (!isBusy(button)) return 'compiled';
  }

  return 'timeout';
}

/**
 * Clicks Overleaf's own download link, so the browser carries the session that
 * signs the URL. Returns false when the project has not been compiled yet, in
 * which case there is no link on the page at all.
 */
export function downloadPdf(doc: Document): boolean {
  const link = pick<HTMLAnchorElement>(doc, PDF_LINK_SELECTORS);
  if (!link) return false;
  link.click();
  return true;
}
