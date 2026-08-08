/**
 * Splits a resume into editable sections and puts it back together again.
 *
 * Resume templates are wildly diverse, so this fails closed: anything it cannot
 * slice cleanly returns null and the editor simply does not appear. The
 * invariant that makes it safe to ship is that reassembling an unmodified parse
 * reproduces the input byte for byte — sections are contiguous slices, so no
 * whitespace or stray content can be dropped between them.
 */

export interface ResumeSection {
  /** Stable across reordering; assigned at parse time. */
  id: string;
  title: string;
  /** The whole block, heading included, up to the next section's start. */
  raw: string;
}

export interface SectionedResume {
  /** Preamble, \begin{document}, and anything before the first section. */
  before: string;
  sections: ResumeSection[];
  /** Everything from the end of the last section, including \end{document}. */
  after: string;
}

/** Heading-command templates: \section{...}, \cvsection{...} and friends. */
const HEADING_PATTERN = /\\(?:section\*|section|cvsection|resumesection|sectiontitle)\s*\{/g;
/** Environment templates: \begin{rSection}{...} ... \end{rSection}. */
const ENVIRONMENT_PATTERN = /\\begin\s*\{rSection\}\s*\{/g;

const MIN_SECTIONS = 2;

interface Boundary {
  /** Index in the full string where this section's block begins. */
  start: number;
  title: string;
}

export function parseSections(latex: string): SectionedResume | null {
  const documentStart = latex.indexOf('\\begin{document}');
  const documentEnd = latex.lastIndexOf('\\end{document}');
  if (documentStart === -1 || documentEnd === -1 || documentEnd <= documentStart) return null;

  const region: [number, number] = [documentStart, documentEnd];
  const headings = findBoundaries(latex, HEADING_PATTERN, region);
  const environments = findBoundaries(latex, ENVIRONMENT_PATTERN, region);

  // A template that mixes both conventions cannot be sliced predictably.
  if (headings.length > 0 && environments.length > 0) return null;

  const boundaries = headings.length > 0 ? headings : environments;
  if (boundaries.length < MIN_SECTIONS) return null;

  const sections: ResumeSection[] = boundaries.map((boundary, i) => ({
    id: `section-${i}`,
    title: boundary.title,
    raw: latex.slice(boundary.start, boundaries[i + 1]?.start ?? documentEnd),
  }));

  return {
    before: latex.slice(0, boundaries[0]!.start),
    sections,
    after: latex.slice(documentEnd),
  };
}

export function assembleSections(doc: SectionedResume): string {
  return doc.before + doc.sections.map((s) => s.raw).join('') + doc.after;
}

/** Replaces a section's visible title inside its own block. */
export function retitleSection(section: ResumeSection, title: string): ResumeSection {
  const open = section.raw.indexOf('{');
  if (open === -1) return { ...section, title };

  const group = readBracedGroup(section.raw, open);
  if (!group) return { ...section, title };

  return {
    ...section,
    title,
    raw: section.raw.slice(0, open + 1) + title + section.raw.slice(group.end),
  };
}

/** The body of a section — everything after its heading line. */
export function sectionBody(section: ResumeSection): string {
  const open = section.raw.indexOf('{');
  const group = open === -1 ? null : readBracedGroup(section.raw, open);
  return group ? section.raw.slice(group.end + 1) : section.raw;
}

export function replaceSectionBody(section: ResumeSection, body: string): ResumeSection {
  const open = section.raw.indexOf('{');
  const group = open === -1 ? null : readBracedGroup(section.raw, open);
  if (!group) return section;
  return { ...section, raw: section.raw.slice(0, group.end + 1) + body };
}

/** Builds a new section using whatever heading command the document already uses. */
export function newSection(doc: SectionedResume, title: string): ResumeSection {
  const template = doc.sections[0]?.raw ?? '';
  const isEnvironment = /^\\begin\s*\{rSection\}/.test(template);

  const raw = isEnvironment
    ? `\n\\begin{rSection}{${title}}\n\n\\end{rSection}\n`
    : `\n${headingCommandOf(template)}{${title}}\n\n`;

  return { id: `section-new-${doc.sections.length}`, title, raw };
}

function headingCommandOf(raw: string): string {
  return raw.match(/^\\(?:section\*|section|cvsection|resumesection|sectiontitle)/)?.[0] ?? '\\section';
}

function findBoundaries(
  latex: string,
  pattern: RegExp,
  [regionStart, regionEnd]: [number, number],
): Boundary[] {
  const found: Boundary[] = [];
  const scanner = new RegExp(pattern.source, 'g');

  let match: RegExpExecArray | null;
  while ((match = scanner.exec(latex)) !== null) {
    if (match.index < regionStart || match.index >= regionEnd) continue;

    // The pattern ends on the opening brace of the title.
    const braceIndex = match.index + match[0].length - 1;
    const group = readBracedGroup(latex, braceIndex);
    if (!group) continue; // unbalanced title; skip rather than mis-slice

    found.push({ start: match.index, title: group.content.trim() });
  }

  return found;
}

/** Reads a `{...}` group, honouring nesting and escaped braces. */
function readBracedGroup(text: string, openIndex: number): { content: string; end: number } | null {
  if (text[openIndex] !== '{') return null;

  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '{' && ch !== '}') continue;

    let backslashes = 0;
    for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) backslashes++;
    if (backslashes % 2 === 1) continue; // escaped brace

    depth += ch === '{' ? 1 : -1;
    if (depth === 0) return { content: text.slice(openIndex + 1, i), end: i };
  }

  return null;
}
