import { describe, expect, it } from 'vitest';
import { validateLatex } from '@/core/pipeline/validateLatex';
import { findIncludedFiles, looksLikeLatex } from '@/core/resumeInput';

const VALID = `\\documentclass{article}
\\usepackage{geometry}
\\begin{document}
\\section{Experience}
\\begin{itemize}
  \\item Built things with 100\\% uptime
\\end{itemize}
\\end{document}`;

describe('validateLatex', () => {
  it('accepts a well-formed document', () => {
    const { problems, warnings } = validateLatex(VALID, VALID.length);
    expect(problems).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('flags a missing \\end{document}', () => {
    const cut = VALID.replace('\\end{document}', '');
    expect(validateLatex(cut, VALID.length).problems.join(' ')).toContain('\\end{document}');
  });

  it('flags a missing \\begin{document}', () => {
    const broken = VALID.replace('\\begin{document}', '');
    expect(validateLatex(broken, VALID.length).problems.join(' ')).toContain('\\begin{document}');
  });

  it('flags an environment that is never closed', () => {
    const broken = VALID.replace('\\end{itemize}', '');
    expect(validateLatex(broken, VALID.length).problems.join(' ')).toContain('itemize');
  });

  it('flags an environment closed by the wrong name', () => {
    const broken = VALID.replace('\\end{itemize}', '\\end{enumerate}');
    const problems = validateLatex(broken, VALID.length).problems.join(' ');
    expect(problems).toContain('itemize');
    expect(problems).toContain('enumerate');
  });

  it('flags a stray \\end with no opener', () => {
    // Outside any environment, so the stack is empty when it is reached.
    const broken = '\\documentclass{article}\n\\end{center}\n\\begin{document}\nx\n\\end{document}';
    expect(validateLatex(broken, broken.length).problems.join(' ')).toContain('without a matching');
  });

  it('ignores environments inside comments', () => {
    const commented = VALID.replace(
      '\\section{Experience}',
      '% \\begin{verbatim} left over from an old draft\n\\section{Experience}',
    );
    expect(validateLatex(commented, commented.length).problems).toEqual([]);
  });

  it('does not count escaped braces', () => {
    const escaped = VALID.replace('\\section{Experience}', '\\section{Experience \\{note\\}}');
    expect(validateLatex(escaped, escaped.length).problems).toEqual([]);
  });

  it('warns on a small brace imbalance but does not fail', () => {
    const slightly = VALID.replace('\\section{Experience}', '\\section{Experience');
    const { problems, warnings } = validateLatex(slightly, slightly.length);
    expect(problems).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('fails on a large brace imbalance', () => {
    const broken = VALID.replace('\\begin{document}', '\\begin{document} { { { {');
    expect(validateLatex(broken, broken.length).problems.join(' ')).toContain('braces');
  });

  it.each([
    '% ... rest unchanged',
    '% rest of the document is unchanged',
    '[...]',
    'The rest of the resume remains unchanged',
  ])('flags the placeholder %j', (marker) => {
    const truncated = VALID.replace('\\section{Experience}', marker);
    expect(validateLatex(truncated, VALID.length).problems.join(' ')).toContain('placeholder');
  });

  it('flags a revision that grew far beyond the original', () => {
    const bloated = VALID + '\n% padding'.repeat(200);
    expect(validateLatex(bloated, VALID.length).problems.join(' ')).toContain('longer');
  });

  it('flags a revision that lost most of its content', () => {
    expect(validateLatex(VALID, VALID.length * 4).problems.join(' ')).toContain('shorter');
  });

  it('skips the length check when there is no original to compare against', () => {
    expect(validateLatex(VALID, 0).problems).toEqual([]);
  });
});

describe('resume input checks', () => {
  it('finds \\input and \\include targets', () => {
    const latex = `\\input{sections/experience}
\\include{education.tex}
\\input{ sections/skills }`;
    expect(findIncludedFiles(latex)).toEqual([
      'sections/experience',
      'education.tex',
      'sections/skills',
    ]);
  });

  it('returns nothing for a single-file resume', () => {
    expect(findIncludedFiles(VALID)).toEqual([]);
  });

  it('recognizes LaTeX documents', () => {
    expect(looksLikeLatex(VALID)).toBe(true);
    expect(looksLikeLatex('Just some text about my career.')).toBe(false);
  });
});
