import { ErrorCode, appError } from '@/core/errors';
import type { ChatMessage, LLMProvider } from '@/core/providers/types';
import { extractJsonObject } from './parseOutput';
import { SCORE_SYSTEM_PROMPT, buildScoreUserPrompt } from './prompts';
import type { JobProfile, MatchScore } from './types';

const MAX_TOKENS = 1024;

/**
 * Stage 3: how well does each version match the job?
 *
 * A separate call, scoring the original and the revision together. Asking the
 * tailoring call to grade its own output produces flattery; scoring both in one
 * pass gives a delta that means something, and it costs one small request.
 */
export async function scoreMatch(
  provider: LLMProvider,
  model: string,
  profile: JobProfile,
  originalLatex: string,
  revisedLatex: string,
): Promise<MatchScore> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SCORE_SYSTEM_PROMPT },
    { role: 'user', content: buildScoreUserPrompt(profile, originalLatex, revisedLatex) },
  ];

  const first = await provider.complete({ model, maxTokens: MAX_TOKENS, messages });
  try {
    return toMatchScore(extractJsonObject(first.text));
  } catch (firstError) {
    const retry = await provider.complete({
      model,
      maxTokens: MAX_TOKENS,
      messages: [
        ...messages,
        { role: 'assistant', content: first.text },
        {
          role: 'user',
          content: 'Your previous reply was not valid JSON. Reply with ONLY the JSON object.',
        },
      ],
    });

    try {
      return toMatchScore(extractJsonObject(retry.text));
    } catch {
      throw firstError;
    }
  }
}

function toMatchScore(value: unknown): MatchScore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw appError(ErrorCode.LLM_BAD_FORMAT, 'The scoring reply was not a JSON object.');
  }
  const raw = value as Record<string, unknown>;

  const originalScore = clampScore(raw.originalScore);
  const revisedScore = clampScore(raw.revisedScore);
  if (originalScore === null || revisedScore === null) {
    throw appError(ErrorCode.LLM_BAD_FORMAT, 'The scoring reply had no usable scores.');
  }

  return {
    originalScore,
    revisedScore,
    rationale: typeof raw.rationale === 'string' ? raw.rationale.trim() : '',
    remainingGaps: Array.isArray(raw.remainingGaps)
      ? raw.remainingGaps
          .filter((g): g is string => typeof g === 'string')
          .map((g) => g.trim())
          .filter(Boolean)
      : [],
  };
}

/** Models occasionally answer "8/10" or 8.5; take the number and pin it to 0-10. */
function clampScore(value: unknown): number | null {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(10, Math.round(numeric)));
}
