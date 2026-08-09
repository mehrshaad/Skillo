import { describe, expect, it, vi } from 'vitest';
import { mountTailorButton, observeAndMount } from '@/lib/jobIntake/injectButton';

const jobPage = (anchor = '<div class="jobs-s-apply"><button>Apply</button></div>') => {
  const doc = document.implementation.createHTMLDocument('LinkedIn');
  doc.body.innerHTML = `<main>${anchor}</main>`;
  return doc;
};

const button = (doc: Document) => doc.getElementById('skillo-tailor-button');

describe('mountTailorButton', () => {
  it('mounts beside the apply button', () => {
    const doc = jobPage();
    expect(mountTailorButton(doc, () => {})).toBe(true);

    const mounted = button(doc);
    expect(mounted).not.toBeNull();
    expect(mounted!.textContent).toBe('Tailor with Skillo');
    // After the anchor, so LinkedIn's own layout is not pushed around.
    expect(mounted!.previousElementSibling?.className).toBe('jobs-s-apply');
  });

  it('is idempotent, because the observer calls it on every mutation', () => {
    const doc = jobPage();
    expect(mountTailorButton(doc, () => {})).toBe(true);
    expect(mountTailorButton(doc, () => {})).toBe(false);
    expect(doc.querySelectorAll('#skillo-tailor-button')).toHaveLength(1);
  });

  it('does nothing on a page with no anchor rather than guessing a spot', () => {
    const doc = jobPage('<div class="something-else"></div>');
    expect(mountTailorButton(doc, () => {})).toBe(false);
    expect(button(doc)).toBeNull();
  });

  it('tries each known anchor', () => {
    for (const cls of ['jobs-apply-button--top-card', 'topcard__content-left', 'jobs-s-apply']) {
      const doc = jobPage(`<div class="${cls}"></div>`);
      expect(mountTailorButton(doc, () => {}), cls).toBe(true);
    }
  });

  it('calls back without letting the click reach the page underneath', () => {
    const doc = jobPage();
    const onClick = vi.fn();
    const pageHandler = vi.fn();
    doc.body.addEventListener('click', pageHandler);
    mountTailorButton(doc, onClick);

    // A detached document has no defaultView, so use the environment's own.
    button(doc)!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(onClick).toHaveBeenCalledTimes(1);
    // LinkedIn's own handlers must not also fire; that could start an apply flow.
    expect(pageHandler).not.toHaveBeenCalled();
  });
});

describe('observeAndMount', () => {
  it('puts it back after the app rerenders it away', async () => {
    const doc = jobPage();
    const stop = observeAndMount(doc, () => {});
    expect(button(doc)).not.toBeNull();

    // What a client-side navigation does: replaces the subtree wholesale.
    doc.querySelector('main')!.innerHTML = '<div class="jobs-s-apply"></div>';
    expect(button(doc)).toBeNull();

    await new Promise((r) => setTimeout(r, 50));
    expect(button(doc)).not.toBeNull();

    stop();
  });

  it('stops touching the page once disconnected', async () => {
    const doc = jobPage();
    const stop = observeAndMount(doc, () => {});
    stop();

    doc.querySelector('main')!.innerHTML = '<div class="jobs-s-apply"></div>';
    await new Promise((r) => setTimeout(r, 50));
    expect(button(doc)).toBeNull();
  });
});
