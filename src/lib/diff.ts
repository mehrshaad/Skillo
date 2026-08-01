import { diffLines } from 'diff';

export type DiffRow =
  | { kind: 'context'; text: string; oldNo: number; newNo: number }
  | { kind: 'add'; text: string; newNo: number }
  | { kind: 'del'; text: string; oldNo: number }
  | { kind: 'gap'; hidden: number };

/**
 * Line diff collapsed to what a reviewer reads: changed lines with a few lines
 * of context, and a marker where unchanged runs were folded away.
 */
export function buildDiff(oldText: string, newText: string, contextLines = 3): DiffRow[] {
  const parts = diffLines(oldText, newText);
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;

  for (const part of parts) {
    const lines = splitLines(part.value);

    if (part.added) {
      for (const text of lines) rows.push({ kind: 'add', text, newNo: ++newNo });
    } else if (part.removed) {
      for (const text of lines) rows.push({ kind: 'del', text, oldNo: ++oldNo });
    } else {
      for (const text of lines) {
        rows.push({ kind: 'context', text, oldNo: ++oldNo, newNo: ++newNo });
      }
    }
  }

  return collapseContext(rows, contextLines);
}

/** Splits into lines without inventing a trailing empty line. */
function splitLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function collapseContext(rows: DiffRow[], contextLines: number): DiffRow[] {
  const keep = new Array<boolean>(rows.length).fill(false);

  rows.forEach((row, i) => {
    if (row.kind === 'add' || row.kind === 'del') {
      const from = Math.max(0, i - contextLines);
      const to = Math.min(rows.length - 1, i + contextLines);
      for (let j = from; j <= to; j++) keep[j] = true;
    }
  });

  const out: DiffRow[] = [];
  let hidden = 0;

  rows.forEach((row, i) => {
    if (keep[i]) {
      if (hidden > 0) {
        out.push({ kind: 'gap', hidden });
        hidden = 0;
      }
      out.push(row);
    } else {
      hidden++;
    }
  });

  if (hidden > 0) out.push({ kind: 'gap', hidden });
  return out;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function diffStats(rows: DiffRow[]): DiffStats {
  return {
    added: rows.filter((r) => r.kind === 'add').length,
    removed: rows.filter((r) => r.kind === 'del').length,
  };
}
