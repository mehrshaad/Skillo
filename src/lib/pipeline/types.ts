/** Stage-1 output: the job posting distilled into what matters for tailoring. */
export interface JobProfile {
  title: string;
  company: string;
  location: string;
  seniority: string;
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  responsibilities: string[];
  toolsAndTech: string[];
  atsKeywords: string[];
  softSkills: string[];
  summaryForTailoring: string;
}

/** Stage-3 output: how well each version matches, and what tailoring could not fix. */
export interface MatchScore {
  originalScore: number;
  revisedScore: number;
  rationale: string;
  /** Requirements the revision still does not evidence. */
  remainingGaps: string[];
}

/** Stage-2 output after parsing the delimiter format. */
export interface TailorResult {
  /** Markdown bullet list of changes and reasoning, straight from the model. */
  changeSummary: string;
  /** The complete revised LaTeX file. */
  latex: string;
  /** Present when the output failed structural validation but is being surfaced anyway. */
  validationErrors?: string[];
}
