import { ErrorCode, appError } from '@/core/errors';
import { latexToPlainText } from '@/core/latexText';
import type { UserProfile } from '@/core/profile';
import type { LLMProvider } from '@/core/providers/types';
import { COVER_LETTER_SYSTEM_PROMPT, buildCoverLetterUserPrompt } from './prompts';
import type { JobProfile } from './types';

export interface CoverLetterInput {
  provider: LLMProvider;
  model: string;
  job: JobProfile;
  /** The tailored resume, so the letter and the CV agree with each other. */
  latex: string;
  notes: string;
  candidate?: UserProfile | null;
}

/**
 * Written from the tailored resume rather than the original, so the two say the
 * same thing. Plain text: a cover letter is not part of the LaTeX document and
 * nobody wants it pasted into one.
 */
export async function writeCoverLetter(input: CoverLetterInput): Promise<string> {
  const response = await input.provider.complete({
    model: input.model,
    maxTokens: 1500,
    messages: [
      { role: 'system', content: COVER_LETTER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildCoverLetterUserPrompt(
          input.job,
          latexToPlainText(input.latex),
          input.notes,
          input.candidate,
        ),
      },
    ],
  });

  const letter = response.text.trim();
  if (letter.length < 200) {
    throw appError(
      ErrorCode.PROVIDER_REQUEST_FAILED,
      'The model returned too little to be a cover letter.',
      letter.slice(0, 200),
    );
  }

  return letter;
}
