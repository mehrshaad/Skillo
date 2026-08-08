import type { JobPosting } from '@/core/jobIntake/types';
import type { PageBudget } from './pageBudget';
import { profileBlock, type UserProfile } from '@/core/profile';
import type { JobProfile } from './types';

/*
 * Prompts are kept verbatim here so they can be reviewed and tuned in one place.
 * Record any tuning below the prompt it applies to, with what failure prompted it.
 */

export const ANALYZE_SYSTEM_PROMPT = `You are an expert technical recruiter and resume strategist. Analyze the job posting provided by the user and return ONLY a JSON object — no markdown fences, no commentary — with exactly these keys:
"title" (string), "company" (string), "location" (string), "salary" (string: what it pays, exactly as the posting states it, e.g. "$120,000–150,000 / year" or "€55k–65k"; read it out of the description body if there is no structured field; "" if the posting genuinely does not say — never guess or estimate a market rate), "employmentType" (string: full-time, part-time, contract, internship, temporary — "" if not stated), "workplaceType" (string: remote, hybrid, on-site — "" if not stated), "seniority" (string), "mustHaveSkills" (string[]), "niceToHaveSkills" (string[]), "responsibilities" (string[], max 8, condensed), "toolsAndTech" (string[]), "atsKeywords" (string[], the exact terms an ATS or reviewer would scan for, including variants like "CI/CD" vs "continuous integration"), "softSkills" (string[]), "summaryForTailoring" (string, 3-5 sentences: what this employer actually values and what a tailored resume should emphasize).
If a field is not determinable, use "" or []. Do not invent information not present in the posting.`;

export function buildAnalyzeUserPrompt(job: JobPosting): string {
  const header = [
    job.title && `Job title: ${job.title}`,
    job.company && `Company: ${job.company}`,
    job.location && `Location: ${job.location}`,
    job.seniority && `Seniority (from LinkedIn): ${job.seniority}`,
    job.employmentType && `Employment type: ${job.employmentType}`,
    job.workplaceType && `Workplace type: ${job.workplaceType}`,
    // Structured pay when the posting carried it; otherwise the model reads the
    // description, which is where most postings bury it.
    job.salary && `Compensation (from the posting): ${job.salary}`,
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

/**
 * Every fit level gets this, because a truthful rewrite that reads like it came
 * out of a machine still loses the interview. The banned words are the ones
 * models reach for unprompted; naming them is what stops them, since "write
 * naturally" on its own does nothing.
 */
const TAILOR_WRITING_STANDARD = `WRITING QUALITY — the result has to read as though a thoughtful person wrote it for this job:
- Write in plain, specific English. A hiring manager should never be able to tell a model touched this resume.
- Never use: spearheaded, leveraged, utilized, orchestrated, championed, pioneered, robust, seamless, cutting-edge, state-of-the-art, best-in-class, results-driven, detail-oriented, passionate, dynamic, synergy, holistic, myriad, plethora, tapestry, delve, underscore. Prefer the ordinary word: used, ran, built, led, cut, shipped.
- Cut empty intensifiers. "Significantly improved" says nothing; either the original gives a number, in which case use it, or state what changed without the adverb.
- One idea per bullet. Say what the candidate did, to what, and what came of it — in that order, in the past tense, without the three-verb chains ("designed, developed, and delivered") models fall into.
- Vary sentence length and structure. A column of identically shaped bullets reads as generated.
- Keep the candidate's own phrasing wherever it already works. This is an edit, not a rewrite from scratch, and their voice is an asset.
- Weave the job's vocabulary into sentences that would have been written anyway. Never append keyword lists, never repeat a term to hit a count, and never write a sentence whose only purpose is to hold a keyword.
- No self-praise adjectives about the candidate. Evidence does that work.`;

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
    TAILOR_WRITING_STANDARD,
    `LENGTH AND PAGES:\n${pageBlock(budget)}`,
    TAILOR_OUTPUT_FORMAT,
  ].join('\n\n');
}

export function buildTailorUserPrompt(
  profile: JobProfile,
  notes: string,
  latex: string,
  candidate?: UserProfile | null,
): string {
  const about = profileBlock(candidate ?? null);

  return [
    `JOB ANALYSIS (JSON):\n${JSON.stringify(profile, null, 2)}`,
    about,
    `CANDIDATE NOTES FOR THIS APPLICATION:\n${notes.trim() || 'none'}`,
    `CURRENT RESUME (LaTeX):\n${latex}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildRegenerateUserPrompt(feedback: string): string {
  return `Revise according to this feedback: ${feedback.trim()}

Work from the revision you just produced — improve that, rather than starting again from the original resume.

If the feedback asks for more or less content, change the amount of content accordingly. Treat it as overriding the earlier length guidance, but never the page limit: if the feedback cannot be honoured without going past the stated page limit, do as much as fits and say plainly in the CHANGES section what you could not do and why.

Same rules, same output format, complete file.`;
}

/*
 * The critique pass. Deliberately hostile: a model asked "is this good?" says
 * yes, and a model asked "what would make you bin this?" finds real problems.
 *
 * It doubles as a truthfulness check. The pass that is most likely to notice an
 * invented claim is the one reading the draft against the original with fresh
 * instructions, so it is told to look — that is worth more than any amount of
 * telling the writer not to invent things in the first place.
 */
export const CRITIQUE_SYSTEM_PROMPT = `You are screening resumes for this exact role, and you have six seconds per resume and eighty to get through. You are not the candidate's friend and you are not writing feedback for them to read.

You will be given the job, the candidate's original resume, and a rewritten version of it. Say what is wrong with the rewrite.

Look for, in this order:
1. ANY claim in the rewrite that is not supported by the original resume. Quote it. This matters more than everything else combined — an invented employer, title, date, metric, certification or skill has to be caught here.
2. Bullets that state a duty rather than what the person did and what came of it.
3. Writing that reads as machine-generated: verb chains, empty intensifiers, identical bullet shapes, corporate filler, keyword stuffing, sentences that exist only to hold a term.
4. Anything that would make you stop reading: burying the relevant experience, a summary that could belong to anyone, formatting noise.
5. Requirements from the job that the resume evidences but does not make visible.

Return ONLY a JSON object — no markdown fences, no commentary — with exactly these keys:
"unsupported" (string[]: each an exact quote from the rewrite that the original does not support; empty if none — do not pad this list),
"weak" (string[]: specific problems, each naming what to change and why),
"missed" (string[]: things the resume genuinely evidences that the rewrite fails to surface for this job),
"verdict" (string, one sentence: would you interview this person on this resume, and what decides it).

Be concrete. "Improve the summary" is useless; "the summary says 'results-driven engineer' and could belong to anyone — it should lead with the Postgres migration, which is what this job asks for" is useful.`;

export function buildCritiqueUserPrompt(
  profile: JobProfile,
  originalLatex: string,
  revisedLatex: string,
): string {
  return `JOB (JSON):
${JSON.stringify(profile, null, 2)}

ORIGINAL RESUME — the only source of truth about this person:
${originalLatex}

REWRITTEN RESUME — the one you are screening:
${revisedLatex}`;
}

export interface Critique {
  unsupported: string[];
  weak: string[];
  missed: string[];
  verdict: string;
}

/** Formats the critique back into an instruction the writer can act on. */
export function buildRevisionPrompt(critique: Critique): string {
  const section = (title: string, items: string[]) =>
    items.length > 0 ? `${title}\n${items.map((i) => `- ${i}`).join('\n')}` : '';

  const body = [
    section(
      'UNSUPPORTED CLAIMS — remove or rewrite every one of these. Nothing here may survive into the final resume unless the original resume genuinely supports it:',
      critique.unsupported,
    ),
    section('WEAKNESSES a screener found:', critique.weak),
    section('RELEVANT EXPERIENCE the rewrite failed to surface:', critique.missed),
    critique.verdict ? `Their verdict: ${critique.verdict}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return `A screener has read your rewrite against the original. Fix what they found.

${body}

Produce the corrected resume in full, under exactly the same rules and the same output format as before. The same page budget applies. Do not respond to the critique in prose — the only output is the revised file.`;
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
