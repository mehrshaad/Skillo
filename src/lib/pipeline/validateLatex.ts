export interface LatexValidation {
  /** Hard failures — worth spending a retry on. */
  problems: string[];
  /** Soft signals shown to the user but not worth a retry. */
  warnings: string[];
}

/** Whole-file rewrites drift; beyond this the model rewrote rather than tailored. */
const MAX_LENGTH_DRIFT = 0.4;
/** Templates do odd things with braces, so only a clear imbalance is a failure. */
const BRACE_TOLERANCE = 2;

const TRUNCATION_MARKERS = [
  /%\s*\.\.\./,
  /%[^\n]*\brest\b[^\n]*\b(unchanged|as before|same)\b/i,
  /%[^\n]*\b(unchanged|omitted|truncated)\b[^\n]*\b(section|content|remainder|rest)\b/i,
  /\[\s*\.\.\.\s*\]/,
  /\b(rest|remainder) of (the )?(document|file|resume) (is |remains )?(unchanged|the same)\b/i,
];

/**
 * Structural checks on a whole-file LaTeX rewrite. This is deliberately a
 * heuristic — it catches the failures that actually happen (truncation, an
 * unclosed environment, a wholesale rewrite) without trying to be a parser.
 * The user still compiles in Overleaf before anything is final.
 */
export function validateLatex(latex: string, originalLength: number): LatexValidation {
  const problems: string[] = [];
  const warnings: string[] = [];
  const code = stripComments(latex);

  if (!/\\begin\{document\}/.test(code)) {
    problems.push('The file is missing \\begin{document}.');
  }
  if (!/\\end\{document\}/.test(code)) {
    problems.push('The file is missing \\end{document} — it looks cut off.');
  }

  const unbalanced = findUnbalancedEnvironment(code);
  if (unbalanced) problems.push(unbalanced);

  const braceDelta = braceBalance(code);
  if (Math.abs(braceDelta) > BRACE_TOLERANCE) {
    problems.push(
      braceDelta > 0
        ? `There are ${braceDelta} more opening than closing braces.`
        : `There are ${-braceDelta} more closing than opening braces.`,
    );
  } else if (braceDelta !== 0) {
    warnings.push('Braces are slightly unbalanced; check the output compiles.');
  }

  for (const marker of TRUNCATION_MARKERS) {
    const found = latex.match(marker);
    if (found) {
      problems.push(`The output contains a placeholder instead of real content: "${found[0].trim()}".`);
      break;
    }
  }

  if (originalLength > 0) {
    const drift = (latex.length - originalLength) / originalLength;
    if (Math.abs(drift) > MAX_LENGTH_DRIFT) {
      problems.push(
        drift > 0
          ? `The revision is ${Math.round(drift * 100)}% longer than the original.`
          : `The revision is ${Math.round(-drift * 100)}% shorter than the original — content was probably dropped.`,
      );
    }
  }

  return { problems, warnings };
}

/** Removes `%` comments, respecting the `\%` escape. */
function stripComments(latex: string): string {
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

function findUnbalancedEnvironment(code: string): string | null {
  const stack: string[] = [];
  const pattern = /\\(begin|end)\s*\{([^}]+)\}/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const [, kind, name] = match as unknown as [string, string, string];
    if (kind === 'begin') {
      stack.push(name);
      continue;
    }
    const open = stack.pop();
    if (open === undefined) return `\\end{${name}} appears without a matching \\begin{${name}}.`;
    if (open !== name) return `\\begin{${open}} was closed by \\end{${name}}.`;
  }

  const dangling = stack.pop();
  return dangling ? `\\begin{${dangling}} is never closed.` : null;
}

function braceBalance(code: string): number {
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch !== '{' && ch !== '}') continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && code[j] === '\\'; j--) backslashes++;
    if (backslashes % 2 === 1) continue; // escaped brace
    depth += ch === '{' ? 1 : -1;
  }
  return depth;
}
