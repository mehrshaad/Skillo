import { ErrorCode, appError } from '@/core/errors';
import type { JobPosting } from '@/core/jobIntake/types';
import type { ChatMessage, LLMProvider } from '@/core/providers/types';
import { ANALYZE_SYSTEM_PROMPT, JSON_RETRY_NUDGE, buildAnalyzeUserPrompt } from './prompts';
import { extractJsonObject, toJobProfile } from './parseOutput';
import type { JobProfile } from './types';

const MAX_TOKENS = 2048;

/**
 * Stage 1: job posting → structured profile. One retry, because "reply with
 * only JSON" is the instruction models most often ignore on the first pass.
 */
export async function analyzeJob(
  provider: LLMProvider,
  model: string,
  job: JobPosting,
): Promise<JobProfile> {
  const messages: ChatMessage[] = [
    { role: 'system', content: ANALYZE_SYSTEM_PROMPT },
    { role: 'user', content: buildAnalyzeUserPrompt(job) },
  ];

  const first = await provider.complete({ model, maxTokens: MAX_TOKENS, messages });
  try {
    return toJobProfile(extractJsonObject(first.text));
  } catch (firstError) {
    if (first.stopReason === 'length') {
      throw appError(
        ErrorCode.LLM_TRUNCATED,
        'The analysis was cut off before it finished. Try a model with a larger output limit.',
      );
    }

    const retry = await provider.complete({
      model,
      maxTokens: MAX_TOKENS,
      messages: [
        ...messages,
        { role: 'assistant', content: first.text },
        { role: 'user', content: JSON_RETRY_NUDGE },
      ],
    });

    try {
      return toJobProfile(extractJsonObject(retry.text));
    } catch {
      // Report the original failure — it describes what actually went wrong.
      throw firstError;
    }
  }
}
