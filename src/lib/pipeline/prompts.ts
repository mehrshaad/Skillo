import type { JobPosting } from '@/lib/jobIntake/types';
import type { PageBudget } from './pageBudget';
import type { JobProfile } from './types';

/*
 * Prompts are kept verbatim here so they can be reviewed and tuned in one place.
 * Record any tuning below the prompt it applies to, with what failure prompted it.
 */

export const ANALYZE_SYSTEM_PROMPT = `You are an expert technical recruiter and resume strategist. Analyze the job posting provided by the user and return ONLY a JSON object — no markdown fences, no commentary — with exactly these keys:
"title" (string), "company" (string), "location" (string), "seniority" (string), "mustHaveSkills" (string[]), "niceToHaveSkills" (string[]), "responsibilities" (string[], max 8, condensed), "toolsAndTech" (string[]), "atsKeywords" (string[], the exact terms an ATS or reviewer would scan for, including variants like "CI/CD" vs "continuous integration"), "softSkills" (string[]), "summaryForTailoring" (string, 3-5 sentences: what this employer actually values and what a tailored resume should emphasize).
If a field is not determinable, use "" or []. Do not invent information not present in the posting.`;

export function buildAnalyzeUserPrompt(job: JobPosting): string {
  const header = [
    job.title && `Job title: ${job.title}`,
    job.company && `Company: ${job.company}`,
    job.location && `Location: ${job.location}`,
    job.seniority && `Seniority (from LinkedIn): ${job.seniority}`,
    job.employmentType && `Employment type: ${job.employmentType}`,
  ]
    .filter(Boolean)
    .join('\n');

  return `${header ? `${header}\n\n` : ''}Job description:\n\n${job.descriptionText}`;
}

/**
 * The absolute rules are shared by every fit level, byte for byte. Only the
 * "how much to change" block varies — the truthfulness rule never does, and a
 * test asserts that. Level 5 changes how hard the resume is packaged for the
 * job, never whether its claims are real.
 */
const TAILOR_ABSOLUTE_RULES = `You are an expert resume writer working in LaTeX. You will receive: (1) a candidate's current resume as a complete LaTeX file, (2) a structured analysis of a job posting, (3) optional notes from the candidate.
Produce a revised version of the SAME LaTeX file, tailored to this job.

ABSOLUTE RULES — these apply no matter how much rewriting is asked for below:
1. NEVER invent employers, job titles, dates, degrees, certifications, projects, metrics, or skills that are not in the original resume or the candidate's notes. You may rephrase, reorder, condense, emphasize, and cut. You may surface a skill the resume already evidences (e.g. list "REST APIs" in a skills line if a bullet clearly shows API work).
2. Keep the documentclass, preamble, packages, and custom macro definitions unchanged unless a change is strictly required. Never switch template.
3. Output the COMPLETE file. Never truncate. Never write placeholders like "% rest unchanged".
4. The output must be compilable LaTeX: every \\begin{x} matched by \\end{x}, braces balanced, special characters escaped as in the original.`;

/** Index 0 is unused so the array reads 1-5 like the UI does. */
const FIT_LEVEL_BLOCKS: readonly string[] = [
  '',
  // 1 - lowest
  `Change as little as possible. Reorder bullets and sections so the most job-relevant material comes first, and surface keywords ONLY where the existing text already states that experience. Do not rephrase sentences except where a keyword swap requires it. Cut nothing.`,
  // 2 - low
  `Conservative pass. Reorder freely; rephrase individual bullets to use the job's vocabulary where the meaning is unchanged; do not restructure sections; cut only clearly irrelevant bullets.`,
  // 3 - medium
  `Balanced pass. Weave in the job's ATS keywords where truthfully applicable, in natural phrasing. Reorder bullets and sections so the most job-relevant material comes first within each section. Rephrase bullets to match the job's vocabulary, and cut material that does not serve this application.`,
  // 4 - high
  `Aggressive alignment. Rewrite bullets around what the employer values, lead every section with the most relevant material, compress or merge weak bullets, and cut content that does not serve this application. Keep every claim traceable to the original.`,
  // 5 - very high
  `Maximum alignment. Restructure section order around the job's priorities, rewrite the summary or profile section entirely for this role, rewrite bullets to mirror the job's language wherever truthful, and cut everything that does not sell this application. The result should read as though it was written for this job — while every fact in it still comes from the original resume or the candidate's notes.`,
];

export const FIT_LEVEL_LABELS: readonly string[] = [
  '',
  'lowest',
  'low',
  'medium',
  'high',
  'very high',
];

/** One-line explanation shown under the fit control. */
export const FIT_LEVEL_CAPTIONS: readonly string[] = [
  '',
  'Barely touches the wording. Reorders, and only adds keywords your resume already earns.',
  'Light touch. Rephrases bullets toward the job, leaves your structure alone.',
  'Balanced. Reorders and rephrases toward the job, keeps your resume recognizable.',
  'Assertive. Rewrites bullets around what this employer wants and cuts what does not serve it.',
  'Rewritten for this job. Restructures and rewrites hard — every fact still yours.',
];

function pageBlock(budget: PageBudget): string {
  const fill = budget.fillLastPage
    ? ` The final page must end essentially full: come within about 10% of the budget by expanding the most job-relevant sections or trimming, whichever is needed. Do not leave a mostly-empty last page, and do not overflow onto another page.`
    : '';

  return `The revised resume must fit ${budget.pageLimit} page${budget.pageLimit === 1 ? '' : 's'} when compiled. Budget roughly ${budget.targetChars} characters of body content (${budget.pageLimit} page${budget.pageLimit === 1 ? '' : 's'} at about ${budget.charsPerPage} characters per page for this template). If the content exceeds that budget, cut the least job-relevant material rather than compressing the formatting.${fill}`;
}

export const TAILOR_OUTPUT_FORMAT = `OUTPUT FORMAT — exactly this structure, nothing before or after:
===CHANGES===
A markdown bullet list of every meaningful change and the reasoning (one line each).
===LATEX===
The complete revised LaTeX file.
===END===`;

export function buildTailorSystemPrompt(fitLevel: number, budget: PageBudget): string {
  const level = FIT_LEVEL_BLOCKS[fitLevel] ?? FIT_LEVEL_BLOCKS[3]!;

  return [
    TAILOR_ABSOLUTE_RULES,
    `HOW MUCH TO CHANGE:\n${level}`,
    `LENGTH AND PAGES:\n${pageBlock(budget)}`,
    TAILOR_OUTPUT_FORMAT,
  ].join('\n\n');
}

export function buildTailorUserPrompt(
  profile: JobProfile,
  notes: string,
  latex: string,
): string {
  return `JOB ANALYSIS (JSON):
${JSON.stringify(profile, null, 2)}

CANDIDATE NOTES:
${notes.trim() || 'none'}

CURRENT RESUME (LaTeX):
${latex}`;
}

export function buildRegenerateUserPrompt(feedback: string): string {
  return `Revise according to this feedback: ${feedback.trim()}

Same rules, same output format, complete file.`;
}

export const SCORE_SYSTEM_PROMPT = `You are a strict technical recruiter. Score how well each of two versions of the same candidate's resume matches the job, from 0 to 10, where 10 means an interview is near-certain on paper and 0 means no relevant match at all. Judge only what is written on the page against what the job demands — do not give credit for potential, effort, or formatting.
Be sceptical: most real resumes score between 4 and 8. Do not inflate the revised version's score simply because it is the newer one; if the rewrite did not add genuine evidence, the two scores should be close.
Return ONLY a JSON object — no markdown fences, no commentary — with exactly these keys:
"originalScore" (integer 0-10), "revisedScore" (integer 0-10), "rationale" (string, at most 2 sentences explaining the difference between the two scores), "remainingGaps" (string[]: requirements the job asks for that the revised resume still does not evidence — the things no amount of rewording could fix without inventing experience).`;

export function buildScoreUserPrompt(
  profile: JobProfile,
  originalLatex: string,
  revisedLatex: string,
): string {
  return `JOB (JSON):
${JSON.stringify(profile, null, 2)}

RESUME A — the original:
${originalLatex}

RESUME B — the revised version:
${revisedLatex}

Score A as "originalScore" and B as "revisedScore".`;
}

/** Appended when the model's previous reply was unusable. */
export const JSON_RETRY_NUDGE =
  'Your previous reply was not valid JSON. Reply with ONLY the JSON object, no fences and no commentary.';

export const FORMAT_RETRY_NUDGE = `Your previous reply did not use the required output format. Reply again using exactly:
===CHANGES===
(bullet list)
===LATEX===
(the complete LaTeX file)
===END===`;

export function buildValidationRetryNudge(problems: string[]): string {
  return `Your previous LaTeX output failed these checks:
${problems.map((p) => `- ${p}`).join('\n')}

Produce the complete corrected file again, in the same output format.`;
}
