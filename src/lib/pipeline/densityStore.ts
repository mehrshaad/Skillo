import { browser } from 'wxt/browser';
import { bodyChars } from '@/core/pipeline/pageBudget';
import {
  learn,
  templateKey,
  type DensityModel,
  type DensityObservation,
} from '@/core/pipeline/density';

/**
 * Where density observations live. The learning itself is pure and sits in
 * core, because the web app needs the same maths without Chrome storage under
 * it; only the reading and writing is extension-shaped.
 */

const STORE_KEY = 'density';
/** Enough to converge; old samples stop being about the same template anyway. */
const MAX_OBSERVATIONS = 12;
const MAX_TEMPLATES = 20;

type DensityStore = Record<string, DensityObservation[]>;

async function readStore(): Promise<DensityStore> {
  const raw = await browser.storage.local.get(STORE_KEY);
  return (raw[STORE_KEY] as DensityStore | undefined) ?? {};
}

export async function getDensityModel(latex: string): Promise<DensityModel | null> {
  const store = await readStore();
  return learn(store[templateKey(latex)] ?? []);
}

/**
 * Records one compiled outcome. `exact` marks a reading a person took off the
 * rendered page, which may be fractional.
 */
export async function recordObservation(
  latex: string,
  pages: number,
  exact = false,
): Promise<void> {
  // A counted page is at least one; a reported fill can be a fraction of one.
  const floor = exact ? 0.05 : 1;
  if (!Number.isFinite(pages) || pages < floor) return;

  const chars = bodyChars(latex);
  if (chars <= 0) return;

  const key = templateKey(latex);
  const store = await readStore();
  const existing = store[key] ?? [];

  // Same measurement twice tells us nothing new.
  const duplicate = existing.some(
    (o) => o.bodyChars === chars && o.pages === pages && Boolean(o.exact) === exact,
  );
  if (duplicate) return;

  store[key] = [
    { bodyChars: chars, pages, ...(exact ? { exact: true } : {}), at: new Date().toISOString() },
    ...existing,
  ].slice(0, MAX_OBSERVATIONS);

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
