import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHARS_PER_PAGE,
  bodyChars,
  computePageBudget,
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

const budget = (over: Partial<ReturnType<typeof computePageBudget>> = {}) => ({
  pageLimit: 2,
  fillLastPage: false,
  charsPerPage: 3600,
  targetChars: 7200,
  calibrated: true,
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

  it('calibrates against the real page count when Overleaf reports one', () => {
    const result = computePageBudget(latex, 2, false, 2);
    expect(result.calibrated).toBe(true);
    expect(result.charsPerPage).toBe(500);
    expect(result.targetChars).toBe(1000);
  });

  it('estimates when the page count is unknown', () => {
    const result = computePageBudget(latex, 2, false, null);
    expect(result.calibrated).toBe(false);
    expect(result.charsPerPage).toBe(DEFAULT_CHARS_PER_PAGE);
    expect(result.targetChars).toBe(DEFAULT_CHARS_PER_PAGE * 2);
  });

  it('does not calibrate off a zero page count', () => {
    expect(computePageBudget(latex, 1, false, 0).calibrated).toBe(false);
  });

  it('carries the fill flag through', () => {
    expect(computePageBudget(latex, 1, true, 1).fillLastPage).toBe(true);
  });
});

describe('validateLatex with a page budget', () => {
  const doc = (bodyLength: number) =>
    `\\documentclass{article}\\begin{document}${'x'.repeat(bodyLength)}\\end{document}`;

  it('accepts output inside the budget', () => {
    expect(validateLatex(doc(7000), 7000, budget()).problems).toEqual([]);
  });

  it('rejects output that will overflow the page limit', () => {
    const problems = validateLatex(doc(9000), 7000, budget()).problems;
    expect(problems.join(' ')).toContain('will not fit 2 pages');
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
    const slightlyOver = doc(8500);
    expect(validateLatex(slightlyOver, 7000, budget({ calibrated: true })).problems).toHaveLength(1);
    expect(validateLatex(slightlyOver, 7000, budget({ calibrated: false })).problems).toEqual([]);
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
