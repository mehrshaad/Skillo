import { ErrorCode, appError } from '@/lib/errors';
import { parseJobDocument } from './parseJobHtml';
import type { ParsedJob } from './types';

/** Below this we assume we grabbed page furniture rather than a real posting. */
export const MIN_USABLE_DESCRIPTION = 300;

/**
 * Extraction from a live LinkedIn tab.
 *
 * The semantic parser is tried first — it wins on the guest-rendered variant.
 * Signed-in sessions get a build with hashed class names and no embedded job
 * JSON, so there is nothing stable to target; we fall back to page text and
 * mark the result low-confidence for the user to eyeball.
 */
export function extractFromLivePage(doc: Document): ParsedJob {
  if (isLoginWall(doc)) {
    throw appError(
      ErrorCode.LINKEDIN_LOGIN_WALL,
      'LinkedIn is asking for a sign-in before showing this posting.',
    );
  }

  const semantic = parseJobDocument(doc);
  if (semantic) return semantic;

  const { title, company } = splitDocumentTitle(doc.title);
  const descriptionText = readableText(doc);

  if (descriptionText.length < MIN_USABLE_DESCRIPTION) {
    throw appError(
      ErrorCode.EXTRACTION_FAILED,
      'Could not find the job description on this page.',
      `Recovered only ${descriptionText.length} characters of text.`,
    );
  }

  return { title, company, location: '', descriptionText, lowConfidence: true };
}

/** LinkedIn tab titles read "Job title | Company | LinkedIn". */
export function splitDocumentTitle(docTitle: string): { title: string; company: string } {
  const parts = docTitle
    .split('|')
    .map((p) => p.trim())
    .filter((p) => p && !/^linkedin$/i.test(p));
  return { title: parts[0] ?? '', company: parts[1] ?? '' };
}

function isLoginWall(doc: Document): boolean {
  const url = doc.location?.href ?? '';
  if (/\/authwall|\/uas\/login|\/checkpoint\//.test(url)) return true;
  const heading = doc.querySelector('h1')?.textContent ?? '';
  return /sign in to (view|see)|join linkedin to/i.test(heading);
}

/** innerText where available (respects hidden elements), textContent otherwise. */
function readableText(doc: Document): string {
  const main = doc.querySelector('main') ?? doc.body;
  if (!main) return '';
  const raw =
    (main as HTMLElement).innerText ?? main.textContent ?? '';
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
