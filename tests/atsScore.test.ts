import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { atsScore, collectTerms, termMatcher } from '@/lib/pipeline/atsScore';
import { latexToPlainText, stripLatexComments } from '@/lib/latexText';
import type { JobProfile } from '@/lib/pipeline/types';

const profile = (over: Partial<JobProfile> = {}): JobProfile => ({
  title: 'Backend Engineer',
  company: 'CtrlChain',
  location: 'Eindhoven',
  seniority: 'Mid-Senior level',
  mustHaveSkills: [],
  niceToHaveSkills: [],
  responsibilities: [],
  toolsAndTech: [],
  atsKeywords: [],
  softSkills: [],
  summaryForTailoring: 'summary',
  ...over,
});

describe('termMatcher', () => {
  const matches = (term: string, text: string) => termMatcher(term).test(text);

  it('matches a plain term case-insensitively', () => {
    expect(matches('Python', 'built services in python')).toBe(true);
  });

  it('does not match a term buried inside a longer word', () => {
    expect(matches('Go', 'I used Google Cloud')).toBe(false);
    expect(matches('Go', 'written in Go for speed')).toBe(true);
  });

  it.each([
    ['CI/CD', 'improved CI/CD pipelines'],
    ['CI/CD', 'improved CI-CD pipelines'],
    ['CI/CD', 'improved CICD pipelines'],
    ['CI/CD', 'improved ci cd pipelines'],
  ])('treats %s as present in %j', (term, text) => {
    expect(matches(term, text)).toBe(true);
  });

  it.each([
    ['Node.js', 'a Node.js service'],
    ['Node.js', 'a NodeJS service'],
    ['Node.js', 'a node js service'],
  ])('treats %s as present in %j', (term, text) => {
    expect(matches(term, text)).toBe(true);
  });

  it('keeps C++ and C# distinct from C', () => {
    expect(matches('C++', 'wrote C++ for the renderer')).toBe(true);
    expect(matches('C++', 'wrote C for the renderer')).toBe(false);
    expect(matches('C#', 'a C# service')).toBe(true);
    expect(matches('C#', 'a C service')).toBe(false);
  });

  it('matches multi-word terms across a line break', () => {
    expect(matches('REST API', 'designed a REST\nAPI for partners')).toBe(true);
  });

  it('does not match a multi-word term glued into another word', () => {
    expect(matches('REST API', 'restful apidocs')).toBe(false);
  });

  it('handles a term that is only punctuation without throwing', () => {
    expect(() => termMatcher('///')).not.toThrow();
    expect(matches('///', 'anything')).toBe(false);
  });
});

describe('collectTerms', () => {
  it('merges the three sources and de-duplicates case-insensitively', () => {
    const terms = collectTerms(
      profile({
        mustHaveSkills: ['Python'],
        atsKeywords: ['python', 'CI/CD'],
        toolsAndTech: ['Docker'],
      }),
    );
    expect(terms.map((t) => t.text.toLowerCase()).sort()).toEqual(['ci/cd', 'docker', 'python']);
  });

  it('keeps the must-have weight when a term appears in several lists', () => {
    const terms = collectTerms(
      profile({ mustHaveSkills: ['Python'], atsKeywords: ['Python'] }),
    );
    expect(terms).toHaveLength(1);
    expect(terms[0]!.weight).toBe(2);
  });
});

describe('atsScore', () => {
  it('returns null when the job lists nothing to screen for', () => {
    expect(atsScore(profile(), 'any resume text')).toBeNull();
  });

  it('scores full coverage as 10', () => {
    const result = atsScore(
      profile({ atsKeywords: ['Python', 'Docker'] }),
      'Python and Docker experience',
    )!;
    expect(result.coverage).toBe(1);
    expect(result.score).toBe(10);
    expect(result.missing).toEqual([]);
  });

  it('scores no coverage as 0 and lists everything missing', () => {
    const result = atsScore(profile({ atsKeywords: ['Rust', 'Kafka'] }), 'Python only')!;
    expect(result.score).toBe(0);
    expect(result.missing).toEqual(['Rust', 'Kafka']);
  });

  it('weights must-have skills double', () => {
    // One must-have (weight 2) covered, one keyword (weight 1) missing → 2/3.
    const result = atsScore(
      profile({ mustHaveSkills: ['Python'], atsKeywords: ['Rust'] }),
      'Python services',
    )!;
    expect(result.coverage).toBeCloseTo(2 / 3, 5);

    // The mirror image scores lower, because the heavier term is the missing one.
    const mirrored = atsScore(
      profile({ mustHaveSkills: ['Python'], atsKeywords: ['Rust'] }),
      'Rust services',
    )!;
    expect(mirrored.coverage).toBeCloseTo(1 / 3, 5);
  });

  it('improves when the revision adds a genuinely present term', () => {
    const job = profile({ atsKeywords: ['Python', 'Kubernetes', 'CI/CD'] });
    const before = atsScore(job, 'Python developer')!;
    const after = atsScore(job, 'Python developer who owned CI/CD and Kubernetes')!;
    expect(after.coverage).toBeGreaterThan(before.coverage);
    expect(after.missing).toEqual([]);
  });
});

describe('latexToPlainText', () => {
  it('does not count a term that only appears in a comment', () => {
    const latex = `\\documentclass{article}\\begin{document}
% TODO: mention Kubernetes somewhere
Built Python services.
\\end{document}`;
    const text = latexToPlainText(latex);
    expect(text).toContain('Python');
    expect(text).not.toContain('Kubernetes');
    expect(atsScore(profile({ atsKeywords: ['Kubernetes'] }), text)!.score).toBe(0);
  });

  it('ignores the preamble, which never prints', () => {
    const latex = `\\documentclass{article}
\\newcommand{\\kubernetes}{K8s}
\\begin{document}Python only.\\end{document}`;
    expect(latexToPlainText(latex)).not.toContain('kubernetes');
  });

  it('keeps the text inside formatting commands', () => {
    const latex = '\\begin{document}\\textbf{Python} and \\emph{Docker}\\end{document}';
    const text = latexToPlainText(latex);
    expect(text).toContain('Python');
    expect(text).toContain('Docker');
    expect(text).not.toContain('textbf');
  });

  it('unescapes specials so percentages and ampersands survive', () => {
    const latex = '\\begin{document}Cut deploys by 40\\% for R\\&D\\end{document}';
    expect(latexToPlainText(latex)).toContain('40%');
    expect(latexToPlainText(latex)).toContain('R&D');
  });

  it('drops list markup but keeps the items', () => {
    const latex = `\\begin{document}\\begin{itemize}[leftmargin=*]
\\item Owned CI/CD
\\end{itemize}\\end{document}`;
    const text = latexToPlainText(latex);
    expect(text).toContain('Owned CI/CD');
    expect(text).not.toContain('itemize');
    expect(text).not.toContain('leftmargin');
  });

  it('reads a real resume fixture into matchable text', () => {
    const latex = readFileSync(
      resolve(__dirname, 'fixtures/latex/article-sections.tex'),
      'utf8',
    );
    const text = latexToPlainText(latex);

    const result = atsScore(
      profile({ mustHaveSkills: ['Python'], atsKeywords: ['CI/CD', 'Kubernetes', 'Rust'] }),
      text,
    )!;
    expect(result.covered.sort()).toEqual(['CI/CD', 'Kubernetes', 'Python']);
    expect(result.missing).toEqual(['Rust']);
  });
});

describe('stripLatexComments', () => {
  it('leaves an escaped percent alone', () => {
    expect(stripLatexComments('uptime 99.9\\% achieved % a note')).toBe(
      'uptime 99.9\\% achieved ',
    );
  });
});
