import { describe, expect, it } from 'vitest';
import { downloadPdf, recompile } from '@/lib/overleaf/compile';

/**
 * Markup copied from a live Overleaf project rather than invented, which is
 * how the class names and `data-ol-loading` were established in the first
 * place — none of the selectors that seemed obvious actually matched.
 */
function projectPage(options: { compiled?: boolean; button?: boolean } = {}): Document {
  const { compiled = true, button = true } = options;
  const doc = document.implementation.createHTMLDocument('Overleaf');
  doc.body.innerHTML = `
    <div class="pdf-viewer"><div class="page" data-page-number="1"></div></div>
    ${
      button
        ? `<div class="compile-button-group dropdown btn-group">
             <button class="d-inline-grid align-items-center py-0 no-left-radius px-3 compile-button btn btn-primary"
                     data-ol-loading="false">Recompile</button>
           </div>`
        : ''
    }
    ${
      compiled
        ? `<a aria-label="Download PDF" download
              href="/download/project/abc/build/def/output/output.pdf">Download PDF</a>`
        : ''
    }`;
  return doc;
}

const compileButton = (doc: Document) =>
  doc.querySelector<HTMLButtonElement>('.compile-button-group button.compile-button')!;

describe('recompile', () => {
  it('presses the button and resolves when the loading flag clears', async () => {
    const doc = projectPage();
    const button = compileButton(doc);

    // Overleaf sets data-ol-loading true, then false when the build lands.
    button.addEventListener('click', () => {
      button.dataset.olLoading = 'true';
      setTimeout(() => {
        button.dataset.olLoading = 'false';
      }, 400);
    });

    await expect(recompile(doc)).resolves.toBe('compiled');
    expect(button.dataset.olLoading).toBe('false');
  });

  it('treats a compile that never starts as done rather than hanging', async () => {
    // Overleaf decided nothing changed. The caller wanted a current PDF and has
    // one, so this is a success.
    const doc = projectPage();
    await expect(recompile(doc)).resolves.toBe('compiled');
  });

  it('waits for a compile already in flight instead of starting a second', async () => {
    const doc = projectPage();
    const button = compileButton(doc);
    button.dataset.olLoading = 'true';

    let clicks = 0;
    button.addEventListener('click', () => {
      clicks++;
    });
    setTimeout(() => {
      button.dataset.olLoading = 'false';
    }, 300);

    await expect(recompile(doc)).resolves.toBe('compiled');
    expect(clicks).toBe(0);
  });

  it('reports a missing button rather than throwing', async () => {
    await expect(recompile(projectPage({ button: false }))).resolves.toBe('no-button');
  });

  it('falls back to the label when the class has been renamed', async () => {
    const doc = projectPage({ button: false });
    doc.body.insertAdjacentHTML('beforeend', '<button class="renamed">Recompile</button>');

    let clicked = false;
    doc.querySelector('button.renamed')!.addEventListener('click', () => {
      clicked = true;
    });

    await expect(recompile(doc)).resolves.toBe('compiled');
    expect(clicked).toBe(true);
  });
});

describe('downloadPdf', () => {
  it('clicks the page’s own link, so the browser carries the signed session', () => {
    const doc = projectPage();
    let clicked = false;
    doc.querySelector('a[download]')!.addEventListener('click', (e) => {
      e.preventDefault();
      clicked = true;
    });

    expect(downloadPdf(doc)).toBe(true);
    expect(clicked).toBe(true);
  });

  it('says no rather than guessing a URL when nothing has compiled', () => {
    // The signed output URL cannot be constructed, only used from the page.
    expect(downloadPdf(projectPage({ compiled: false }))).toBe(false);
  });
});
