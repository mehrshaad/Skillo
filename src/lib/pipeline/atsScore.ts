import type { JobProfile } from './types';

/**
 * How much of what the job screens for actually appears in the resume.
 *
 * Computed locally, with no model call, because this is a fact rather than a
 * judgement: either the term is on the page or it is not. That makes it exact,
 * instant, free, and explainable down to the individual missing word — none of
 * which is true of asking a model "how ATS-friendly is this?".
 *
 * It is reported, never optimised for. Missing terms are gaps to be honest
 * about; the tailoring prompt still forbids claiming experience you do not have.
 */
export interface AtsResult {
  covered: string[];
  missing: string[];
  /** Weighted 0-1: must-have terms count double. */
  coverage: number;
  /** The same figure as 0-10, to sit alongside the match score. */
  score: number;
}

/** Missing a must-have is not the same as missing a nice-to-have. */
const MUST_HAVE_WEIGHT = 2;
const NORMAL_WEIGHT = 1;

interface Term {
  text: string;
  weight: number;
}

export function collectTerms(profile: JobProfile): Term[] {
  const byKey = new Map<string, Term>();

  const add = (text: string, weight: number) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    const existing = byKey.get(key);
    // A term listed as both a must-have and a keyword keeps the higher weight.
    if (!existing || weight > existing.weight) byKey.set(key, { text: trimmed, weight });
  };

  for (const skill of profile.mustHaveSkills) add(skill, MUST_HAVE_WEIGHT);
  for (const keyword of profile.atsKeywords) add(keyword, NORMAL_WEIGHT);
  for (const tool of profile.toolsAndTech) add(tool, NORMAL_WEIGHT);

  return [...byKey.values()];
}

/**
 * Builds a matcher for one term.
 *
 * Punctuation is where naive matching falls apart: `CI/CD`, `CI-CD` and `CICD`
 * are the same thing to a reader, and `C++` and `C#` must not be reduced to
 * `C`. So the term is split on its punctuation into alphanumeric runs (keeping
 * `+` and `#`, which are part of language names) and rejoined with a flexible
 * separator. Lookarounds rather than `\b` do the boundary work, because `\b`
 * behaves unhelpfully next to `+` and `#`.
 */
export function termMatcher(term: string): RegExp {
  const parts = term
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter(Boolean)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (parts.length === 0) return /(?!)/; // matches nothing

  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[\\s._/-]*')}(?![\\p{L}\\p{N}])`, 'iu');
}

/** null when the job profile lists nothing to screen for. */
export function atsScore(profile: JobProfile, resumeText: string): AtsResult | null {
  const terms = collectTerms(profile);
  if (terms.length === 0) return null;

  const covered: string[] = [];
  const missing: string[] = [];
  let earned = 0;
  let possible = 0;

  for (const term of terms) {
    possible += term.weight;
    if (termMatcher(term.text).test(resumeText)) {
      covered.push(term.text);
      earned += term.weight;
    } else {
      missing.push(term.text);
    }
  }

  const coverage = possible === 0 ? 0 : earned / possible;
  return { covered, missing, coverage, score: Math.round(coverage * 10) };
}
