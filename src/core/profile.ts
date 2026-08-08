/**
 * What Skillo knows about the person, beyond what their resume happens to say.
 *
 * Deliberately free text rather than a form. A form invites one-word answers;
 * a prompt-shaped box gets the paragraph that actually helps — "I want out of
 * consultancy and into product", "the Tipax numbers were mine, not the team's".
 *
 * This is treated exactly like the notes field on the tailor step: facts the
 * candidate has asserted about themselves. It never overrides the resume as a
 * source of truth, and it never licenses inventing anything.
 */
export interface UserProfile {
  /** Who they are, roughly where they are in their career, what they want next. */
  summary: string;
  /** Things a resume cannot show: visa status, notice period, relocation, salary floor. */
  constraints: string;
  /** Achievements and numbers the resume is underselling or leaving out. */
  evidence: string;
  /** Tone, words to avoid, en-GB versus en-US. */
  preferences: string;
  /** Whatever they pasted from another assistant, kept verbatim. */
  imported: string;
  updatedAt: string;
}

export const EMPTY_PROFILE: UserProfile = {
  summary: '',
  constraints: '',
  evidence: '',
  preferences: '',
  imported: '',
  updatedAt: '',
};

export function isProfileEmpty(profile: UserProfile | null): boolean {
  if (!profile) return true;
  return !(
    profile.summary.trim() ||
    profile.constraints.trim() ||
    profile.evidence.trim() ||
    profile.preferences.trim() ||
    profile.imported.trim()
  );
}

/**
 * The profile as the tailoring prompt sees it. Returns '' when there is nothing
 * worth sending, so an empty profile costs no tokens and changes no output.
 */
export function profileBlock(profile: UserProfile | null): string {
  if (isProfileEmpty(profile)) return '';

  const sections: [string, string][] = [
    ['Who they are and what they want next', profile!.summary],
    ['Constraints a resume cannot show', profile!.constraints],
    ['Evidence they say the resume undersells', profile!.evidence],
    ['How they want to be written about', profile!.preferences],
    ['Notes they exported from another assistant', profile!.imported],
  ];

  const body = sections
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `${label}:\n${value.trim()}`)
    .join('\n\n');

  return `ABOUT THE CANDIDATE — asserted by them, so you may use it as fact about them, exactly like their notes. It does NOT license inventing employers, titles, dates or metrics that appear nowhere in the resume: if something here is not also supported by the resume, you may use it to decide what to emphasize and how to phrase things, but not to manufacture a new claim.

${body}`;
}

/**
 * Prompts the user runs in another assistant to get back what it already knows
 * about them. The last line matters more than the rest: without it these dumps
 * confabulate, and confabulation is the one thing Skillo will not put in a CV.
 */
export const IMPORT_PROMPTS: { id: string; label: string; prompt: string }[] = [
  {
    id: 'general',
    label: 'ChatGPT, Claude, Gemini',
    prompt: `Write out everything you know about me that would help someone write my CV.

Include: roles and employers with dates, technologies and tools I have used, projects I have described to you, any numbers or results I have quoted, how I talk about my own work, and anything I have said about what I want to do next.

Plain prose, organised by job. No preamble, no headings addressed to me, no flattery, no advice.

Where you do not actually know something, write "not recorded" for it. Do not infer, estimate, or fill gaps with what is typical for my field — anything invented here would end up in a real job application.`,
  },
  {
    id: 'linkedin',
    label: 'From your LinkedIn',
    prompt: `I am pasting my LinkedIn profile below. Rewrite it as plain prose notes for whoever is going to write my CV: roles with dates, what I actually did in each, technologies, and any measurable outcomes.

Keep every number and proper noun exactly as written. Do not add anything that is not in the text I pasted, and do not smooth over gaps — say "not stated" instead.

---
[paste your LinkedIn profile here]`,
  },
];
