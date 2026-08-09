import { profileBlock, type UserProfile } from '@/core/profile';
import type { ChatMessage, LLMProvider } from '@/core/providers/types';
import type { AtsResult } from './atsScore';
import type { PageBudget } from './pageBudget';
import type { JobProfile, MatchScore } from './types';
import { validateLatex } from './validateLatex';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  /** Present when the reply rewrote the resume rather than answering a question. */
  latex?: string;
  /** Set when that rewrite failed the LaTeX checks, so it cannot be applied. */
  validationErrors?: string[];
  at: string;
}

export interface ChatInput {
  provider: LLMProvider;
  model: string;
  job: JobProfile;
  /** The revision as it currently stands — what edits apply to. */
  latex: string;
  /** The untouched resume: the only thing that makes a claim supportable. */
  originalLatex: string;
  budget: PageBudget;
  match?: MatchScore;
  ats?: { before: AtsResult; after: AtsResult };
  candidate?: UserProfile | null;
  turns: ChatTurn[];
  message: string;
}

const LATEX_OPEN = '===LATEX===';
const LATEX_CLOSE = '===END===';

/**
 * One surface, two jobs, decided by what was asked rather than by a mode switch
 * the user has to think about first.
 *
 * "Move education above experience" is an edit and comes back as a file.
 * "What will they ask me?" is coaching and comes back as prose. The model is
 * told which shape to use; the parser works out which it chose.
 */
export const CHAT_SYSTEM_PROMPT = `You are this candidate's coach. You have their real resume, the real job they are applying for, and how well the two actually match. Talk to them directly, the way a good friend who happens to hire people would.

You do two things, and you decide which from what they asked:

1. THEY ASK FOR A CHANGE to the resume ("move education up", "shorten the second bullet", "make the summary less generic").
   Reply with one or two sentences saying what you changed and why, then the COMPLETE revised LaTeX file between ${LATEX_OPEN} and ${LATEX_CLOSE}.
   Keep the documentclass, preamble and macros exactly as they are. Never truncate, never write "% rest unchanged".

2. THEY ASK A QUESTION — about the job, the interview, where they are weak, what the role really involves, whether to apply at all.
   Answer in prose. No LaTeX block at all. Do not offer to edit unless they asked.

RULES THAT APPLY TO BOTH:
- Never invent experience, employers, titles, dates, metrics or skills that are not in their original resume or in what they have told you. This applies to interview advice as much as to edits: coaching someone to claim something they have not done sets them up to be caught in the room, which is worse than not getting the interview.
- Be specific and use what you have been given. "You are missing Kubernetes" is worth saying; "tailor your resume to the role" is not. Cite their actual bullets and the job's actual requirements.
- Be honest about weak spots. They can only prepare for the gap you name. Do not soften a real problem into a compliment.
- Where they genuinely lack something the job asks for, say so and help them answer for it honestly — what is the closest thing they have done, how fast have they picked up something unfamiliar before.
- Plain English. No "I'd be happy to help", no restating their question, no bullet lists where a sentence works.`;

function contextBlock(input: ChatInput): string {
  const parts = [
    `THE JOB:\n${JSON.stringify(input.job, null, 2)}`,
    profileBlock(input.candidate ?? null),
  ];

  if (input.match) {
    parts.push(
      `HOW WELL IT MATCHES, scored ${input.match.originalScore} before tailoring and ${input.match.revisedScore} out of 10 after.\n` +
        `${input.match.rationale}\n` +
        (input.match.remainingGaps.length > 0
          ? `Still not evidenced by the resume:\n${input.match.remainingGaps.map((g) => `- ${g}`).join('\n')}`
          : 'Nothing the job asks for is left unevidenced.'),
    );
  }

  if (input.ats?.after.missing.length) {
    parts.push(
      `KEYWORDS THE RESUME STILL DOES NOT CARRY: ${input.ats.after.missing.join(', ')}`,
    );
  }

  parts.push(`THEIR ORIGINAL RESUME — the only source of fact about them:\n${input.originalLatex}`);
  parts.push(`THE CURRENT REVISION — this is what an edit should modify:\n${input.latex}`);

  return parts.filter(Boolean).join('\n\n');
}

export interface ChatReply {
  text: string;
  latex?: string;
  validationErrors?: string[];
}

/** Splits a reply into the prose and the file, if it produced one. */
export function parseChatReply(raw: string): { text: string; latex?: string } {
  const open = raw.indexOf(LATEX_OPEN);
  if (open === -1) return { text: raw.trim() };

  const after = open + LATEX_OPEN.length;
  const close = raw.indexOf(LATEX_CLOSE, after);
  const latex = (close === -1 ? raw.slice(after) : raw.slice(after, close)).trim();

  const text = raw.slice(0, open).trim();
  if (!latex) return { text: text || raw.trim() };

  return {
    text: text || 'Updated the resume.',
    latex,
  };
}

export async function chatAboutResume(input: ChatInput): Promise<ChatReply> {
  const history: ChatMessage[] = input.turns.map((turn) => ({
    role: turn.role,
    // Replay the file too, or a follow-up edit is made against the wrong text.
    content: turn.latex ? `${turn.content}\n${LATEX_OPEN}\n${turn.latex}\n${LATEX_CLOSE}` : turn.content,
  }));

  const response = await input.provider.complete({
    model: input.model,
    maxTokens: 8192,
    messages: [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      { role: 'user', content: contextBlock(input) },
      ...history,
      { role: 'user', content: input.message },
    ],
  });

  const parsed = parseChatReply(response.text);
  if (!parsed.latex) return { text: parsed.text };

  // An edit that will not compile is worse than no edit, so it is surfaced but
  // never offered for applying.
  const { problems } = validateLatex(parsed.latex, input.originalLatex.length, input.budget);
  return problems.length > 0
    ? { text: parsed.text, latex: parsed.latex, validationErrors: problems }
    : { text: parsed.text, latex: parsed.latex };
}
