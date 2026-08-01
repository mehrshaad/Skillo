import { useMemo } from 'react';
import { buildDiff, diffStats } from '@/lib/diff';
import { Eyebrow } from './ui';

/**
 * Changed lines carry a proofreader's mark in the margin — the one place the
 * panel spends colour, because this is the screen the user has to trust.
 */
export function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = useMemo(() => buildDiff(oldText, newText), [oldText, newText]);
  const stats = useMemo(() => diffStats(rows), [rows]);

  if (stats.added === 0 && stats.removed === 0) {
    return <p className="text-xs text-muted">The model returned the resume unchanged.</p>;
  }

  return (
    <div className="space-y-1.5">
      <Eyebrow>
        Diff · <span className="text-add">+{stats.added}</span>{' '}
        <span className="text-cut">−{stats.removed}</span> lines
      </Eyebrow>

      <div className="max-h-96 overflow-auto rounded-sm border border-rule bg-white">
        <table className="w-full border-collapse font-mono text-[11px] leading-snug">
          <tbody>
            {rows.map((row, i) => {
              if (row.kind === 'gap') {
                return (
                  <tr key={i} className="bg-paper-sunk">
                    <td colSpan={3} className="px-2 py-0.5 text-center text-[10px] text-muted">
                      ⋯ {row.hidden} unchanged {row.hidden === 1 ? 'line' : 'lines'}
                    </td>
                  </tr>
                );
              }

              const tone =
                row.kind === 'add'
                  ? 'bg-add-wash text-add'
                  : row.kind === 'del'
                    ? 'bg-cut-wash text-cut'
                    : 'text-muted';
              const mark = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : '';
              const lineNo = row.kind === 'del' ? row.oldNo : row.newNo;

              return (
                <tr key={i} className={tone}>
                  <td className="w-8 select-none border-r border-rule px-1 text-right align-top text-[10px] text-muted/70">
                    {lineNo}
                  </td>
                  <td className="w-3 select-none px-1 text-center align-top">{mark}</td>
                  <td className="whitespace-pre-wrap break-words px-1 py-px align-top">
                    {row.text || ' '}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
