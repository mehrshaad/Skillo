/**
 * A "Tailor with Skillo" button on the job page itself, so the flow starts
 * where the job is rather than in a panel the user has to remember to open.
 *
 * Three things make this harder than it looks:
 *
 * 1. LinkedIn is a single-page app that rerenders constantly, so mounting is
 *    idempotent and driven by a MutationObserver rather than done once.
 * 2. `chrome.sidePanel.open` needs a user gesture and the gesture is spent by
 *    the first await, so the click handler must message the worker
 *    synchronously and let it do the opening.
 * 3. It is someone else's page. It matches their button styling, never moves
 *    their layout, and disappears cleanly if the markup changes.
 */

const BUTTON_ID = 'skillo-tailor-button';

/** Where LinkedIn puts Apply / Save. First match wins; all are optional. */
const ANCHOR_SELECTORS = [
  '.jobs-apply-button--top-card',
  '.jobs-s-apply',
  '.job-details-jobs-unified-top-card__container--two-pane .display-flex',
  '.topcard__content-left',
  '.top-card-layout__cta-container',
] as const;

function findAnchor(doc: Document): Element | null {
  for (const selector of ANCHOR_SELECTORS) {
    const el = doc.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function build(doc: Document, onClick: () => void): HTMLButtonElement {
  const button = doc.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = 'Tailor with Skillo';
  button.setAttribute('aria-label', 'Tailor my resume for this job with Skillo');

  // Inline so nothing depends on LinkedIn's stylesheet, and nothing of ours
  // leaks into their page.
  Object.assign(button.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    margin: '8px 8px 8px 0',
    padding: '6px 14px',
    borderRadius: '999px',
    border: '1px solid #132033',
    background: '#132033',
    color: '#ffffff',
    font: '600 14px/1.2 -apple-system, "Segoe UI", system-ui, sans-serif',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });

  return button;
}

/**
 * Mounts the button if it is not already there. Safe to call on every mutation:
 * it is a no-op once mounted, and re-mounts by itself when LinkedIn throws the
 * node away during a client-side navigation.
 */
export function mountTailorButton(doc: Document, onClick: () => void): boolean {
  if (doc.getElementById(BUTTON_ID)) return false;

  const anchor = findAnchor(doc);
  if (!anchor) return false;

  anchor.insertAdjacentElement('afterend', build(doc, onClick));
  return true;
}

/** Keeps it mounted across the SPA's rerenders. Returns a disconnect function. */
export function observeAndMount(doc: Document, onClick: () => void): () => void {
  mountTailorButton(doc, onClick);

  const observer = new MutationObserver(() => {
    mountTailorButton(doc, onClick);
  });
  observer.observe(doc.body, { childList: true, subtree: true });

  return () => observer.disconnect();
}
