/** Past this, a whole-file rewrite gets expensive enough to warn about. */
export const LARGE_RESUME_CHARS = 60_000;

/**
 * Finds files pulled in with \input or \include. Skillo edits only the document
 * it was given, so anything listed here will not be tailored.
 */
export function findIncludedFiles(latex: string): string[] {
  const found = new Set<string>();
  const pattern = /\\(?:input|include)\s*\{([^}]+)\}/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(latex)) !== null) {
    const name = match[1]?.trim();
    if (name) found.add(name);
  }
  return [...found];
}

/** A .tex file that is really a resume should at least look like a document. */
export function looksLikeLatex(text: string): boolean {
  return /\\documentclass|\\begin\{document\}/.test(text);
}
