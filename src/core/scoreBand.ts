/**
 * Words for a 0-10 score. The bands follow the scoring prompt's own calibration
 * ("most real resumes score between 4 and 8"), so "moderate" really is the
 * middle of the distribution rather than a polite way of saying poor.
 */
export type ScoreBand = 'very low' | 'low' | 'moderate' | 'strong' | 'excellent';

export function scoreBand(score: number): ScoreBand {
  if (score <= 2) return 'very low';
  if (score <= 4) return 'low';
  if (score <= 6) return 'moderate';
  if (score <= 8) return 'strong';
  return 'excellent';
}

/** Maps a band onto the palette's existing semantic colours. */
export function bandTextClass(band: ScoreBand): string {
  switch (band) {
    case 'very low':
    case 'low':
      return 'text-cut';
    case 'moderate':
      return 'text-warn';
    default:
      return 'text-add';
  }
}
