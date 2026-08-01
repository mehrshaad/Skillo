import { browser } from 'wxt/browser';
import { hashText } from '@/lib/hash';
import { bodyChars } from './pageBudget';

/**
 * Learns how much text one page of a given template holds.
 *
 * Overleaf's viewer will not tell us how full a page is — it renders no text
 * layer and virtualizes canvases, so there is nothing to measure (see
 * docs/findings.md). It will tell us the page count, and an integer page count
 * is a step
 * function of content, so it carries bounds. A document of B body characters
 * that compiles to P pages proves:
 *
 *     (P-1) · C  <  B  ≤  P · C          C = capacity of one full page
 *   ⇒ C ≥ B / P   and, when P > 1,   C < B / (P-1)
 *
 * Every compile therefore narrows an interval for C. Budgets are built from the
 * lower bound, which cannot overflow by construction; the upper bound says how
 * much room is left to fill.
 *
 * Observations are free: reading a document yields one, and every page check
 * after applying yields another.
 */

export interface DensityObservation {
  bodyChars: number;
  pages: number;
  at: string;
}

export interface DensityModel {
  /** Characters that certainly fit on one page. */
  lower: number;
  /** Characters that certainly do not all fit on one page, when known. */
  upper: number | null;
  samples: number;
}

const STORE_KEY = 'density';
/** Enough to converge; old samples stop being about the same template anyway. */
const MAX_OBSERVATIONS = 12;
const MAX_TEMPLATES = 20;

type DensityStore = Record<string, DensityObservation[]>;

/**
 * Identifies the template rather than the document. The preamble decides
 * margins, font size and spacing — the things that set how much text a page
 * holds — so editing your bullet points keeps the learned density, while
 * switching template correctly starts over.
 */
export function templateKey(latex: string): string {
  const start = latex.indexOf('\\begin{document}');
  return hashText(start === -1 ? latex.slice(0, 2000) : latex.slice(0, start));
}

export function learn(observations: DensityObservation[]): DensityModel | null {
  const usable = observations.filter(
    (o) => Number.isFinite(o.bodyChars) && o.bodyChars > 0 && o.pages >= 1,
  );
  if (usable.length === 0) return null;

  let lower = 0;
  let upper: number | null = null;

  for (const o of usable) {
    lower = Math.max(lower, o.bodyChars / o.pages);
    if (o.pages > 1) {
      const bound = o.bodyChars / (o.pages - 1);
      upper = upper === null ? bound : Math.min(upper, bound);
    }
  }

  // Restructuring changes height-per-character, so samples can contradict each
  // other. Trust the safe bound and drop the aspirational one rather than
  // inventing a reconciliation.
  if (upper !== null && upper <= lower) upper = null;

  return { lower: Math.round(lower), upper: upper === null ? null : Math.round(upper), samples: usable.length };
}

/* ------------------------------------------------------------------ storage */

async function readStore(): Promise<DensityStore> {
  const raw = await browser.storage.local.get(STORE_KEY);
  return (raw[STORE_KEY] as DensityStore | undefined) ?? {};
}

export async function getDensityModel(latex: string): Promise<DensityModel | null> {
  const store = await readStore();
  return learn(store[templateKey(latex)] ?? []);
}

/** Records one compiled outcome for the template this document uses. */
export async function recordObservation(latex: string, pages: number): Promise<void> {
  if (!Number.isFinite(pages) || pages < 1) return;

  const chars = bodyChars(latex);
  if (chars <= 0) return;

  const key = templateKey(latex);
  const store = await readStore();
  const existing = store[key] ?? [];

  // Same measurement twice tells us nothing new.
  const duplicate = existing.some((o) => o.bodyChars === chars && o.pages === pages);
  if (duplicate) return;

  store[key] = [{ bodyChars: chars, pages, at: new Date().toISOString() }, ...existing].slice(
    0,
    MAX_OBSERVATIONS,
  );

  // Keep the store small: drop the templates touched longest ago.
  const keys = Object.keys(store);
  if (keys.length > MAX_TEMPLATES) {
    const ranked = keys.sort(
      (a, b) => (store[b]![0]?.at ?? '').localeCompare(store[a]![0]?.at ?? ''),
    );
    for (const stale of ranked.slice(MAX_TEMPLATES)) delete store[stale];
  }

  await browser.storage.local.set({ [STORE_KEY]: store });
}

export async function clearDensity(): Promise<void> {
  await browser.storage.local.remove(STORE_KEY);
}
