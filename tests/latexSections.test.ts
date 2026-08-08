import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assembleSections,
  newSection,
  parseSections,
  replaceSectionBody,
  retitleSection,
  sectionBody,
} from '@/core/latexSections';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, 'fixtures/latex', name), 'utf8');

const FIXTURES = ['article-sections.tex', 'rsection-template.tex', 'custom-macro.tex'];

describe('round trip', () => {
  // The invariant the whole editor rests on: if this holds, no user edit can
  // silently lose content that was not deliberately changed.
  it.each(FIXTURES)('reassembles %s byte for byte', (name) => {
    const latex = fixture(name);
    const parsed = parseSections(latex);
    expect(parsed).not.toBeNull();
    expect(assembleSections(parsed!)).toBe(latex);
  });

  it.each(FIXTURES)('keeps the preamble out of the sections in %s', (name) => {
    const parsed = parseSections(fixture(name))!;
    expect(parsed.before).toContain('\\documentclass');
    expect(parsed.before).toContain('\\begin{document}');
    expect(parsed.after.trimStart().startsWith('\\end{document}')).toBe(true);
    for (const section of parsed.sections) {
      expect(section.raw).not.toContain('\\documentclass');
      expect(section.raw).not.toContain('\\end{document}');
    }
  });
});

describe('parseSections', () => {
  it('reads heading-command sections', () => {
    const parsed = parseSections(fixture('article-sections.tex'))!;
    expect(parsed.sections.map((s) => s.title)).toEqual(['Experience', 'Education', 'Skills']);
  });

  it('reads environment sections', () => {
    const parsed = parseSections(fixture('rsection-template.tex'))!;
    expect(parsed.sections.map((s) => s.title)).toEqual(['Summary', 'Experience', 'Education']);
  });

  it('reads custom heading macros, including nested braces in a title', () => {
    const parsed = parseSections(fixture('custom-macro.tex'))!;
    expect(parsed.sections.map((s) => s.title)).toEqual(['Profile', 'Work {History}', 'Projects']);
  });

  it('ignores the macro definitions in the preamble', () => {
    // \newcommand{\cvsection}... and \newenvironment{rSection}... must not
    // register as sections.
    const parsed = parseSections(fixture('custom-macro.tex'))!;
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.before).toContain('\\newcommand{\\cvsection}');
  });

  it('gives each section a stable id', () => {
    const parsed = parseSections(fixture('article-sections.tex'))!;
    expect(new Set(parsed.sections.map((s) => s.id)).size).toBe(3);
  });

  it('returns null when there is no document environment', () => {
    expect(parseSections('\\section{One}\n\\section{Two}')).toBeNull();
  });

  it('returns null for a document with fewer than two sections', () => {
    expect(
      parseSections('\\documentclass{article}\\begin{document}\\section{Only}\\end{document}'),
    ).toBeNull();
  });

  it('returns null when a template mixes both conventions', () => {
    const mixed = `\\documentclass{article}\\begin{document}
\\section{One}
\\begin{rSection}{Two}\\end{rSection}
\\end{document}`;
    expect(parseSections(mixed)).toBeNull();
  });

  it('returns null rather than mis-slicing an unbalanced title', () => {
    const broken = '\\documentclass{article}\\begin{document}\\section{Unclosed\\end{document}';
    expect(parseSections(broken)).toBeNull();
  });
});

describe('editing operations', () => {
  const parsed = () => parseSections(fixture('article-sections.tex'))!;

  it('reorders without losing content', () => {
    const doc = parsed();
    const [experience, education, skills] = doc.sections;
    const reordered = assembleSections({
      ...doc,
      sections: [skills!, experience!, education!],
    });

    expect(reordered.indexOf('\\section{Skills}')).toBeLessThan(
      reordered.indexOf('\\section{Experience}'),
    );
    // Nothing vanished: same characters, different order.
    expect(reordered.length).toBe(fixture('article-sections.tex').length);
    expect(reordered).toContain('GPA: 3.42/4.0');
  });

  it('removes a section cleanly', () => {
    const doc = parsed();
    const without = assembleSections({
      ...doc,
      sections: doc.sections.filter((s) => s.title !== 'Education'),
    });
    expect(without).not.toContain('\\section{Education}');
    expect(without).not.toContain('TU Delft');
    expect(without).toContain('\\section{Experience}');
    expect(without).toContain('\\end{document}');
  });

  it('renames a section in the text as well as the model', () => {
    const doc = parsed();
    const renamed = retitleSection(doc.sections[0]!, 'Relevant Experience');
    expect(renamed.title).toBe('Relevant Experience');
    expect(renamed.raw).toContain('\\section{Relevant Experience}');
    expect(renamed.raw).not.toContain('\\section{Experience}');
    // The body is untouched.
    expect(renamed.raw).toContain('cutting deploy time by 40\\%');
  });

  it('renames without disturbing a nested-brace title', () => {
    const doc = parseSections(fixture('custom-macro.tex'))!;
    const renamed = retitleSection(doc.sections[1]!, 'Employment');
    expect(renamed.raw).toContain('\\cvsection{Employment}');
    expect(renamed.raw).toContain('Owned the internal build system');
  });

  it('round-trips a body through read and replace', () => {
    const section = parsed().sections[2]!;
    const body = sectionBody(section);
    expect(body).toContain('Python, Go, Docker');
    expect(replaceSectionBody(section, body).raw).toBe(section.raw);
  });

  it('replaces a body without touching the heading', () => {
    const section = parsed().sections[2]!;
    const edited = replaceSectionBody(section, '\nPython, Rust\n');
    expect(edited.raw).toBe('\\section{Skills}\nPython, Rust\n');
  });

  it('creates a new section using the document\'s own heading command', () => {
    const heading = newSection(parsed(), 'Certifications');
    expect(heading.raw).toContain('\\section{Certifications}');

    const environment = newSection(parseSections(fixture('rsection-template.tex'))!, 'Awards');
    expect(environment.raw).toContain('\\begin{rSection}{Awards}');
    expect(environment.raw).toContain('\\end{rSection}');
  });

  it('keeps a document assembling after an added section', () => {
    const doc = parsed();
    const added = { ...doc, sections: [...doc.sections, newSection(doc, 'Certifications')] };
    const assembled = assembleSections(added);

    expect(assembled).toContain('\\section{Certifications}');
    expect(assembled.indexOf('\\section{Certifications}')).toBeLessThan(
      assembled.indexOf('\\end{document}'),
    );
    // And it can be parsed again.
    expect(parseSections(assembled)!.sections).toHaveLength(4);
  });
});
