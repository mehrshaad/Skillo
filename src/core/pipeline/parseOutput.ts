import { ErrorCode, appError } from '@/core/errors';
import type { JobProfile } from './types';

/* ------------------------------------------------------------------- JSON */

/**
 * Models wrap JSON in fences or add a sentence before it even when told not to.
 * Strip fences, then scan for the first balanced object, ignoring braces that
 * appear inside strings.
 */
export function extractJsonObject(text: string): unknown {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf('{');
  if (start === -1) {
    throw appError(ErrorCode.LLM_BAD_FORMAT, 'The model did not return a JSON object.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch (e) {
          throw appError(
            ErrorCode.LLM_BAD_FORMAT,
            'The model returned malformed JSON.',
            e instanceof Error ? e.message : String(e),
          );
        }
      }
    }
  }

  throw appError(
    ErrorCode.LLM_BAD_FORMAT,
    'The model returned an incomplete JSON object — it may have been cut off.',
  );
}

const STRING_KEYS = [
  'title',
  'company',
  'location',
  'salary',
  'employmentType',
  'workplaceType',
  'seniority',
  'summaryForTailoring',
] as const;
const ARRAY_KEYS = [
  'mustHaveSkills',
  'niceToHaveSkills',
  'responsibilities',
  'toolsAndTech',
  'atsKeywords',
  'softSkills',
] as const;

/** Coerces the model's object into a JobProfile, tolerating missing keys. */
export function toJobProfile(value: unknown): JobProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw appError(ErrorCode.LLM_BAD_FORMAT, 'The model did not return a JSON object.');
  }
  const raw = value as Record<string, unknown>;

  const profile = {} as JobProfile;
  for (const key of STRING_KEYS) {
    profile[key] = typeof raw[key] === 'string' ? (raw[key] as string).trim() : '';
  }
  for (const key of ARRAY_KEYS) {
    profile[key] = Array.isArray(raw[key])
      ? (raw[key] as unknown[])
          .filter((x): x is string => typeof x === 'string')
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
  }

  // A profile with nothing usable means the analysis failed, whatever it parsed to.
  const hasSignal =
    profile.summaryForTailoring.length > 0 ||
    profile.mustHaveSkills.length > 0 ||
    profile.atsKeywords.length > 0;
  if (!hasSignal) {
    throw appError(
      ErrorCode.LLM_BAD_FORMAT,
      'The analysis came back empty. Check that the job description actually contains the posting.',
    );
  }

  return profile;
}

/* -------------------------------------------------------------- delimiters */

export interface TailorOutput {
  changeSummary: string;
  latex: string;
}

const DELIMITED = /===\s*CHANGES\s*===([\s\S]*?)===\s*LATEX\s*===([\s\S]*?)(?:===\s*END\s*===|$)/;

/**
 * The delimiter format exists so a whole LaTeX file never has to survive JSON
 * string escaping. Parsing stays deliberately forgiving about surrounding
 * whitespace and stray code fences.
 */
export function parseTailorOutput(text: string): TailorOutput {
  const match = text.match(DELIMITED);
  if (!match) {
    throw appError(
      ErrorCode.LLM_BAD_FORMAT,
      'The model did not use the required output format.',
    );
  }

  const changeSummary = match[1]!.trim();
  const latex = stripCodeFences(match[2]!).trim();

  if (!latex) {
    throw appError(ErrorCode.LLM_BAD_FORMAT, 'The model returned an empty LaTeX section.');
  }

  return { changeSummary, latex };
}

/* ------------------------------------------------------------------ shared */

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return fenced?.[1] ?? trimmed;
}
