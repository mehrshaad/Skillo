import { ErrorCode, appError, toAppError } from '@/core/errors';
import type { ChatMessage, LLMProvider } from '@/core/providers/types';
import { extractJsonObject, parseTailorOutput } from './parseOutput';
import type { PageBudget } from './pageBudget';
import {
  CRITIQUE_SYSTEM_PROMPT,
  FORMAT_RETRY_NUDGE,
  buildCritiqueUserPrompt,
  buildRevisionPrompt,
  buildRegenerateUserPrompt,
  buildTailorSystemPrompt,
  buildTailorUserPrompt,
  buildValidationRetryNudge,
  type Critique,
} from './prompts';
import type { UserProfile } from '@/core/profile';
import type { JobProfile, TailorResult } from './types';
import { validateLatex } from './validateLatex';

const BASE_MAX_TOKENS = 8192;
const MAX_MAX_TOKENS = 16384;

export interface TailorInput {
  provider: LLMProvider;
  model: string;
  profile: JobProfile;
  notes: string;
  latex: string;
  fitLevel: number;
  budget: PageBudget;
  /** What the user told Skillo about themselves. Absent is normal. */
  candidate?: UserProfile | null;
}

export async function tailorResume(input: TailorInput): Promise<TailorResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildTailorSystemPrompt(input.fitLevel, input.budget) },
    { role: 'user', content: buildTailorUserPrompt(input.profile, input.notes, input.latex, input.candidate) },
  ];
  return runTailorExchange(input, messages);
}

export async function regenerateResume(
  input: TailorInput,
  previousOutput: string,
  feedback: string,
): Promise<TailorResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildTailorSystemPrompt(input.fitLevel, input.budget) },
    { role: 'user', content: buildTailorUserPrompt(input.profile, input.notes, input.latex, input.candidate) },
    { role: 'assistant', content: previousOutput },
    { role: 'user', content: buildRegenerateUserPrompt(feedback) },
  ];
  return runTailorExchange(input, messages);
}

/**
 * The critique pass: a hostile screener reads the draft against the original.
 *
 * Returns null rather than throwing when it fails or comes back unparseable.
 * A critique is additive — losing it costs polish, whereas failing the run
 * costs the whole resume, and the same rule already protects match scoring.
 */
export async function critiqueRevision(
  input: TailorInput,
  draft: TailorResult,
): Promise<Critique | null> {
  try {
    const response = await input.provider.complete({
      model: input.model,
      maxTokens: 2048,
      messages: [
        { role: 'system', content: CRITIQUE_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildCritiqueUserPrompt(input.profile, input.latex, draft.latex),
        },
      ],
    });

    const raw = extractJsonObject(response.text) as Partial<Critique>;
    const list = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

    const critique: Critique = {
      unsupported: list(raw.unsupported),
      weak: list(raw.weak),
      missed: list(raw.missed),
      verdict: typeof raw.verdict === 'string' ? raw.verdict : '',
    };

    const hasFindings =
      critique.unsupported.length + critique.weak.length + critique.missed.length > 0;
    return hasFindings ? critique : null;
  } catch (e) {
    console.warn('[skillo] critique pass failed; keeping the draft', e);
    return null;
  }
}

/** The third pass: hand the draft and the critique back to the writer. */
export async function reviseFromCritique(
  input: TailorInput,
  draft: TailorResult,
  critique: Critique,
): Promise<TailorResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: buildTailorSystemPrompt(input.fitLevel, input.budget) },
    {
      role: 'user',
      content: buildTailorUserPrompt(input.profile, input.notes, input.latex, input.candidate),
    },
    { role: 'assistant', content: asModelOutput(draft) },
    { role: 'user', content: buildRevisionPrompt(critique) },
  ];
  return runTailorExchange(input, messages);
}

/** Rebuilds the assistant turn so a draft can be revised in context. */
function asModelOutput(result: TailorResult): string {
  return `===CHANGES===\n${result.changeSummary}\n===LATEX===\n${result.latex}\n===END===`;
}

/**
 * One exchange, with a single corrective retry. The retry is spent on whichever
 * problem actually occurred — truncation, wrong format, or a structural LaTeX
 * failure — because those need different corrections.
 *
 * If the second attempt also fails validation the result is still returned, with
 * `validationErrors` set, so the user can inspect or copy it rather than losing
 * the work entirely.
 */
async function runTailorExchange(
  input: TailorInput,
  messages: ChatMessage[],
): Promise<TailorResult> {
  const { provider, model, latex, budget } = input;
  let maxTokens = BASE_MAX_TOKENS;
  let conversation = messages;
  let lastResult: TailorResult | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await provider.complete({ model, maxTokens, messages: conversation });

    if (response.stopReason === 'length') {
      if (attempt === 1 || maxTokens >= MAX_MAX_TOKENS) {
        throw appError(
          ErrorCode.LLM_TRUNCATED,
          'The model ran out of room before finishing the resume.',
          'Try a model with a larger output limit, or shorten the resume.',
        );
      }
      maxTokens = Math.min(maxTokens * 2, MAX_MAX_TOKENS);
      continue; // same conversation, more room
    }

    let parsed;
    try {
      parsed = parseTailorOutput(response.text);
    } catch (e) {
      const error = toAppError(e);
      if (attempt === 1) throw error;
      conversation = [
        ...conversation,
        { role: 'assistant', content: response.text },
        { role: 'user', content: FORMAT_RETRY_NUDGE },
      ];
      continue;
    }

    const { problems, warnings } = validateLatex(parsed.latex, latex.length, budget);
    const allIssues = [...problems, ...warnings];

    if (problems.length === 0) {
      return allIssues.length > 0
        ? { ...parsed, validationErrors: warnings }
        : parsed;
    }

    lastResult = { ...parsed, validationErrors: problems };
    if (attempt === 1) break;

    conversation = [
      ...conversation,
      { role: 'assistant', content: response.text },
      { role: 'user', content: buildValidationRetryNudge(problems) },
    ];
  }

  if (lastResult) return lastResult;

  throw appError(
    ErrorCode.VALIDATION_FAILED,
    'The model could not produce a usable revision after two attempts.',
  );
}
