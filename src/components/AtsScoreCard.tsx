import type { AtsResult } from '@/lib/pipeline/atsScore';
import { bandTextClass, scoreBand } from '@/lib/scoreBand';
import { useUiPref } from './useUiPref';
import { Collapsible, Eyebrow } from './ui';

const percent = (coverage: number) => `${Math.round(coverage * 100)}%`;

/**
 * How much of what the job screens for is actually on the page. Counted, not
 * judged — so the missing list is exact, and it sits below the match score
 * because it answers "what should I add", not "should I apply".
 */
export function AtsScoreCard({ before, after }: { before: AtsResult; after: AtsResult }) {
  const [open, setOpen] = useUiPref('atsExpanded');

  const band = scoreBand(after.score);
  const missing = after.missing.length;

  return (
    <Collapsible
      title="ATS keywords"
      open={open}
      onToggle={setOpen}
      hint={missing > 0 ? `${missing} missing` : 'all covered'}
      headline={
        <span className="flex items-baseline gap-1.5 font-mono">
          <span className="text-xs text-muted">{percent(before.coverage)}</span>
          <span aria-hidden className="text-[10px] text-muted">
            →
          </span>
          <span className={`text-base font-bold ${bandTextClass(band)}`}>
            {percent(after.coverage)}
          </span>
        </span>
      }
    >
      <p className="text-xs text-muted">
        Terms this job screens for that appear in your resume. Counted from the text, not
        judged — every applicant tracking system scores differently, so treat this as
        coverage rather than a pass mark.
      </p>

      {missing > 0 && (
        <div className="space-y-1 border-t border-rule pt-2">
          <Eyebrow>Not on your resume</Eyebrow>
          <div className="flex flex-wrap gap-1">
            {after.missing.map((term) => (
              <span
                key={term}
                className="rounded border border-cut/40 bg-cut-wash px-1.5 py-0.5 font-mono text-[10px] text-cut"
              >
                {term}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted">
            Only add these if you genuinely have them. Padding keywords you can't back up
            is how a resume fails the interview instead of the filter.
          </p>
        </div>
      )}

      {after.covered.length > 0 && (
        <div className="space-y-1 border-t border-rule pt-2">
          <Eyebrow>Covered · {after.covered.length}</Eyebrow>
          <div className="flex flex-wrap gap-1">
            {after.covered.map((term) => (
              <span
                key={term}
                className="rounded border border-add/40 bg-add-wash px-1.5 py-0.5 font-mono text-[10px] text-add"
              >
                {term}
              </span>
            ))}
          </div>
        </div>
      )}
    </Collapsible>
  );
}
