import type { MatchScore } from '@/lib/pipeline/types';
import { Eyebrow } from './ui';

/**
 * The delta is the one number that answers "did this help?", so it is the
 * boldest thing on the screen. The gaps under it are the honest half: what
 * tailoring could not fix without inventing experience.
 */
export function MatchScoreCard({ match }: { match: MatchScore }) {
  const delta = match.revisedScore - match.originalScore;

  return (
    <section className="space-y-2 rounded-sm border-2 border-rule bg-paper-sunk px-3 py-2.5">
      <Eyebrow>Match against this job</Eyebrow>

      <div className="flex items-baseline gap-2 font-mono">
        <span className="text-lg font-semibold text-muted">{match.originalScore}</span>
        <span aria-hidden className="text-sm text-muted">
          →
        </span>
        <span className="text-3xl font-bold leading-none text-proof">
          {match.revisedScore}
        </span>
        <span className="text-sm font-semibold text-muted">/10</span>
        {delta !== 0 && (
          <span
            className={`ml-auto text-xs font-bold ${delta > 0 ? 'text-add' : 'text-cut'}`}
          >
            {delta > 0 ? `+${delta}` : delta}
          </span>
        )}
      </div>

      <p className="sr-only">
        Match score went from {match.originalScore} out of 10 to {match.revisedScore} out of 10.
      </p>

      {match.rationale && <p className="text-xs text-muted">{match.rationale}</p>}

      {match.remainingGaps.length > 0 && (
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
    </section>
  );
}
