import type { MatchScore } from '@/lib/pipeline/types';
import { bandTextClass, scoreBand } from '@/lib/scoreBand';
import { useUiPref } from './useUiPref';
import { Collapsible, Eyebrow } from './ui';

/**
 * The headline number: did this rewrite actually improve your case? Collapsed
 * by default so the diff stays the focus, but the collapsed row still shows how
 * many gaps remain — the uncomfortable part is never hidden behind a chevron.
 */
export function MatchScoreCard({ match }: { match: MatchScore }) {
  const [open, setOpen] = useUiPref('matchExpanded');

  const band = scoreBand(match.revisedScore);
  const delta = match.revisedScore - match.originalScore;
  const gaps = match.remainingGaps.length;

  return (
    <Collapsible
      title="Match"
      open={open}
      onToggle={setOpen}
      hint={gaps > 0 ? `${gaps} ${gaps === 1 ? 'gap' : 'gaps'}` : undefined}
      headline={
        <span className="flex items-baseline gap-1.5 font-mono">
          <span className="text-xs text-muted">{match.originalScore}</span>
          <span aria-hidden className="text-[10px] text-muted">
            →
          </span>
          <span className={`text-base font-bold ${bandTextClass(band)}`}>
            {match.revisedScore}
          </span>
          <span className="text-[10px] text-muted">/10</span>
          <span className={`text-[10px] font-semibold ${bandTextClass(band)}`}>{band}</span>
        </span>
      }
    >
      <p className="sr-only">
        Match score went from {match.originalScore} to {match.revisedScore} out of 10, {band}.
      </p>

      {delta !== 0 && (
        <p className={`font-mono text-xs font-bold ${delta > 0 ? 'text-add' : 'text-cut'}`}>
          {delta > 0 ? `+${delta}` : delta} after tailoring
        </p>
      )}

      {match.rationale && <p className="text-xs text-muted">{match.rationale}</p>}

      {gaps > 0 && (
        <div className="space-y-1 border-t border-rule pt-2">
          <Eyebrow>What still doesn't match</Eyebrow>
          <ul className="space-y-0.5 text-xs text-ink">
            {match.remainingGaps.map((gap) => (
              <li key={gap}>· {gap}</li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            Tailoring can't close these without inventing experience, which Skillo won't do.
          </p>
        </div>
      )}
    </Collapsible>
  );
}
