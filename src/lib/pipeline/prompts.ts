import type { JobPosting } from '@/lib/jobIntake/types';
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

export const TAILOR_SYSTEM_PROMPT = `You are an expert resume writer working in LaTeX. You will receive: (1) a candidate's current resume as a complete LaTeX file, (2) a structured analysis of a job posting, (3) optional notes from the candidate.
Produce a revised version of the SAME LaTeX file, tailored to this job.

STRICT RULES:
1. NEVER invent employers, job titles, dates, degrees, certifications, projects, metrics, or skills that are not in the original resume or the candidate's notes. You may rephrase, reorder, condense, emphasize, and cut. You may surface a skill the resume already evidences (e.g. list "REST APIs" in a skills line if a bullet clearly shows API work).
2. Keep the documentclass, preamble, packages, and custom macro definitions unchanged unless a change is strictly required. Never switch template.
3. Preserve overall length: if the original fits one page, the revision must plausibly still fit one page (similar total content volume).
4. Weave in the job's ATS keywords where truthfully applicable, in natural phrasing.
5. Reorder bullets/sections so the most job-relevant material comes first within each section.
6. Output the COMPLETE file. Never truncate. Never write placeholders like "% rest unchanged".
7. The output must be compilable LaTeX: every \\begin{x} matched by \\end{x}, braces balanced, special characters escaped as in the original.

OUTPUT FORMAT — exactly this structure, nothing before or after:
===CHANGES===
A markdown bullet list of every meaningful change and the reasoning (one line each).
===LATEX===
The complete revised LaTeX file.
===END===`;

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
