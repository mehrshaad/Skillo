export type JobSource = 'guest-api' | 'active-tab' | 'background-tab' | 'manual';

export interface JobPosting {
  jobId: string | null;
  url: string;
  title: string;
  company: string;
  location: string;
  seniority?: string;
  employmentType?: string;
  workplaceType?: string;
  /** Plain text, whitespace-normalized. */
  descriptionText: string;
  source: JobSource;
  /** Set when the parser fell back to a coarse strategy and the user should eyeball the result. */
  lowConfidence?: boolean;
  extractedAt: string;
}

/** What a parser returns before the source/timestamp envelope is added. */
export type ParsedJob = Omit<JobPosting, 'source' | 'extractedAt' | 'url' | 'jobId'>;
