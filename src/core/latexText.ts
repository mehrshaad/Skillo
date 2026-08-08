/**
 * Turning LaTeX into the words a reader (or an applicant tracking system)
 * actually sees. Deliberately lossy and deliberately conservative: dropping
 * something is safe, inventing something is not, so every rule here either
 * keeps text or removes markup — none of them rewrite words.
 */

/** The part of the file that prints; the preamble never reaches the page. */
export function documentBody(latex: string): string {
  const start = latex.indexOf('\\begin{document}');
  const end = latex.lastIndexOf('\\end{document}');
  if (start === -1 || end === -1 || end <= start) return latex;
  return latex.slice(start + '\\begin{document}'.length, end);
}

/** How much printable content the document carries. */
export function bodyChars(latex: string): number {
  return documentBody(latex).length;
}

/** Removes `%` comments, honouring the `\%` escape. */
export function stripLatexComments(latex: string): string {
  return latex
    .split('\n')
    .map((line) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== '%') continue;
        let backslashes = 0;
        for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) backslashes++;
        if (backslashes % 2 === 0) return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

/** Commands whose braced argument is layout, not content. */
const DISCARDED_ARGUMENT_COMMANDS =
  /\\(?:hspace|vspace|kern|rule|includegraphics|label|ref|cite|usepackage|documentclass|newcommand|renewcommand|definecolor|setlength|fontsize|selectfont|color|textcolor)\s*\*?\s*(?:\[[^\]]*\])?\s*(?:\{[^{}]*\})?/g;

/**
 * Best-effort plain text for keyword matching. Only the document body is
 * considered, because the preamble never prints — a term defined in a macro
 * name is not a term the reader sees.
 */
export function latexToPlainText(latex: string): string {
  let text = stripLatexComments(latex);

  const start = text.indexOf('\\begin{document}');
  if (start !== -1) text = text.slice(start + '\\begin{document}'.length);
  const end = text.lastIndexOf('\\end{document}');
  if (end !== -1) text = text.slice(0, end);

  return (
    text
      // Environment delimiters carry no reader-visible text.
      .replace(/\\(?:begin|end)\s*\{[^}]*\}(?:\[[^\]]*\])?/g, ' ')
      .replace(DISCARDED_ARGUMENT_COMMANDS, ' ')
      // Any other command: drop the token, keep whatever it wrapped.
      .replace(/\\[a-zA-Z@]+\s*\*?\s*(?:\[[^\]]*\])?/g, ' ')
      // Escaped specials become the character they stood for.
      .replace(/\\([&%$#_{}])/g, '$1')
      // Remaining structural punctuation.
      .replace(/[{}$~^]/g, ' ')
      .replace(/\\\\/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
