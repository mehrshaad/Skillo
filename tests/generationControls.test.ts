import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARS_PER_PAGE,
  bodyChars,
  computePageBudget,
  projectedPages,
  type PageBudget,
} from '@/lib/pipeline/pageBudget';
import { buildTailorSystemPrompt } from '@/lib/pipeline/prompts';
import { validateLatex } from '@/lib/pipeline/validateLatex';
import { readPageCount } from '@/lib/overleaf/pageCount';

const FABRICATION_RULE =
  'NEVER invent employers, job titles, dates, degrees, certifications, projects, metrics, or skills';

/** Distinctive phrase from each level block, used to prove exclusivity. */
const LEVEL_MARKERS = [
  '',
  'Change as little as possible',
  'Conservative pass',
  'Balanced pass',
  'Aggressive alignment',
  'Maximum alignment',
];

const budget = (over: Partial<PageBudget> = {}): PageBudget => ({
  pageLimit: 2,
  fillLastPage: false,
  charsPerPage: 3600,
  targetChars: 7200,
  ceilingChars: null,
  calibrated: true,
  samples: 3,
  ...over,
});

describe('buildTailorSystemPrompt', () => {
  it('includes exactly one fit-level block', () => {
    for (let level = 1; level <= 5; level++) {
      const prompt = buildTailorSystemPrompt(level, budget());
      const present = LEVEL_MARKERS.map((m, i) => (i > 0 && prompt.includes(m) ? i : 0)).filter(
        Boolean,
      );
      expect(present).toEqual([level]);
    }
  });

  it('carries the no-fabrication rule at every level, identically', () => {
    const rules = new Set<string>();
    for (let level = 1; level <= 5; level++) {
      const prompt = buildTailorSystemPrompt(level, budget());
      expect(prompt).toContain(FABRICATION_RULE);
      // The whole absolute-rules block must be byte-identical across levels.
      rules.add(prompt.slice(0, prompt.indexOf('HOW MUCH TO CHANGE')));
    }
    expect(rules.size).toBe(1);
  });

  it('always demands the delimiter output format', () => {
    for (let level = 1; level <= 5; level++) {
      const prompt = buildTailorSystemPrompt(level, budget());
      expect(prompt).toContain('===LATEX===');
      expect(prompt).toContain('===END===');
    }
  });

  it('falls back to the balanced block for an out-of-range level', () => {
    expect(buildTailorSystemPrompt(9, budget())).toContain('Balanced pass');
  });

  it('states the page budget in numbers the model can act on', () => {
    const prompt = buildTailorSystemPrompt(3, budget({ pageLimit: 1, targetChars: 3600 }));
    expect(prompt).toContain('must fit 1 page ');
    expect(prompt).toContain('3600 characters');
  });

  it('adds the fill instruction only when the toggle is on', () => {
    expect(buildTailorSystemPrompt(3, budget({ fillLastPage: false }))).not.toContain(
      'end essentially full',
    );
    expect(buildTailorSystemPrompt(3, budget({ fillLastPage: true }))).toContain(
      'end essentially full',
    );
  });
});

describe('page budget', () => {
  const latex = `\\documentclass{article}
\\usepackage{a-very-long-preamble-that-does-not-print}
\\begin{document}${'x'.repeat(1000)}\\end{document}`;

  it('counts only what prints', () => {
    expect(bodyChars(latex)).toBe(1000);
  });

  it('falls back to the whole string when there is no document environment', () => {
    expect(bodyChars('no document here')).toBe('no document here'.length);
  });

  it('aims into the learned interval rather than at its pessimistic floor', () => {
    const result = computePageBudget(2, false, { lower: 3600, upper: 4600, samples: 3 });
    expect(result.calibrated).toBe(true);
    // 40% into [3600, 4600].
    expect(result.charsPerPage).toBe(4000);
    expect(result.targetChars).toBe(8000);
    // The ceiling stays where the template was actually seen to spill.
    expect(result.ceilingChars).toBe(9200);
  });

  it('aims higher when asked to fill the page', () => {
    const model = { lower: 3600, upper: 4600, samples: 3 };
    const normal = computePageBudget(2, false, model);
    const filling = computePageBudget(2, true, model);

    expect(filling.charsPerPage).toBeGreaterThan(normal.charsPerPage);
    expect(filling.charsPerPage).toBeLessThan(model.upper);
  });

  it('falls back to the floor while no upper bound is known', () => {
    const result = computePageBudget(1, false, { lower: 3600, upper: null, samples: 1 });
    expect(result.charsPerPage).toBe(3600);
    expect(result.ceilingChars).toBeNull();
  });

  it('estimates until something has been learned', () => {
    const result = computePageBudget(2, false, null);
    expect(result.calibrated).toBe(false);
    expect(result.charsPerPage).toBe(DEFAULT_CHARS_PER_PAGE);
    expect(result.targetChars).toBe(DEFAULT_CHARS_PER_PAGE * 2);
    expect(result.samples).toBe(0);
  });

  it('carries the fill flag through', () => {
    expect(computePageBudget(1, true, null).fillLastPage).toBe(true);
  });

  it('projects pages only from a calibrated budget', () => {
    const calibrated = computePageBudget(2, false, { lower: 500, upper: null, samples: 1 });
    expect(projectedPages(latex, calibrated)).toBe(2);
    expect(projectedPages(latex, computePageBudget(2, false, null))).toBeNull();
  });
});

describe('validateLatex with a page budget', () => {
  const doc = (bodyLength: number) =>
    `\\documentclass{article}\\begin{document}${'x'.repeat(bodyLength)}\\end{document}`;

  it('accepts output inside the budget', () => {
    expect(validateLatex(doc(7000), 7000, budget()).problems).toEqual([]);
  });

  it('rejects output well past the budget when no ceiling has been learned', () => {
    const problems = validateLatex(doc(9500), 7000, budget()).problems;
    expect(problems.join(' ')).toContain('will not fit 2 pages');
  });

  it('uses a learned ceiling in preference to a multiple of the target', () => {
    const learned = budget({ ceilingChars: 7500 });
    // Between target and ceiling: unknown, so allowed.
    expect(validateLatex(doc(7400), 7000, learned).problems).toEqual([]);
    // Past the size this template was seen to spill at: rejected.
    expect(validateLatex(doc(7600), 7000, learned).problems.join(' ')).toContain(
      'seen to spill past',
    );
  });

  it('rejects a half-empty last page only when filling was asked for', () => {
    const short = doc(4000);
    expect(validateLatex(short, 7000, budget({ fillLastPage: true })).problems.join(' ')).toContain(
      'leaves the last page mostly empty',
    );
    expect(validateLatex(short, 7000, budget({ fillLastPage: false })).problems).toEqual([]);
  });

  it('rejects output that was gutted even when not filling', () => {
    expect(validateLatex(doc(500), 7000, budget()).problems.join(' ')).toContain('too much was cut');
  });

  it('is more forgiving when the budget is only an estimate', () => {
    const over = doc(9500);
    expect(validateLatex(over, 7000, budget({ calibrated: true })).problems).toHaveLength(1);
    expect(validateLatex(over, 7000, budget({ calibrated: false })).problems).toEqual([]);
  });

  it('supersedes the generic drift rule', () => {
    // Far longer than the original, but inside the page budget: allowed.
    expect(validateLatex(doc(7000), 1000, budget()).problems).toEqual([]);
    // Same input without a budget trips the old drift check.
    expect(validateLatex(doc(7000), 1000).problems.join(' ')).toContain('longer than the original');
  });

  it('still enforces structure alongside the budget', () => {
    const broken = `\\documentclass{article}\\begin{document}\\begin{itemize}${'x'.repeat(7000)}\\end{document}`;
    expect(validateLatex(broken, 7000, budget()).problems.join(' ')).toContain('itemize');
  });
});

describe('readPageCount', () => {
  const dom = (html: string) => new DOMParser().parseFromString(html, 'text/html');

  it('reads the highest page number PDF.js rendered', () => {
    const doc = dom(`<div class="pdf-viewer"><div class="pdfViewer">
      <div class="page" data-page-number="1"><canvas></canvas></div>
      <div class="page" data-page-number="2"><canvas></canvas></div>
    </div></div>`);
    expect(readPageCount(doc)).toBe(2);
  });

  it('counts pages whose canvas has not been rendered yet', () => {
    // PDF.js virtualizes canvases but keeps a placeholder for every page.
    const doc = dom(`<div class="pdf-viewer">
      <div class="page" data-page-number="1"><canvas></canvas></div>
      <div class="page" data-page-number="2"></div>
      <div class="page" data-page-number="3"></div>
    </div>`);
    expect(readPageCount(doc)).toBe(3);
  });

  it('falls back to a bare .page selector', () => {
    expect(readPageCount(dom('<div class="page" data-page-number="4"></div>'))).toBe(4);
  });

  it('returns null when the PDF pane is not there', () => {
    expect(readPageCount(dom('<div class="editor">no pdf</div>'))).toBeNull();
  });

  it('returns null rather than guessing when page numbers are unreadable', () => {
    expect(readPageCount(dom('<div class="page" data-page-number="abc"></div>'))).toBeNull();
  });

  it('is not fooled by the editor line-number gutter', () => {
    const doc = dom(`<div class="cm-gutters">
      <div class="cm-gutterElement">1</div><div class="cm-gutterElement">2</div>
    </div>`);
    expect(readPageCount(doc)).toBeNull();
  });
});
