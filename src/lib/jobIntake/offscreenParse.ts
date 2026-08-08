import { browser } from 'wxt/browser';
import { sendMessage } from '@/lib/messages';
import type { ParsedJob } from '@/core/jobIntake/types';

const OFFSCREEN_PATH = 'offscreen.html';

let ensuring: Promise<void> | null = null;

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;

  // Chrome allows exactly one offscreen document; concurrent creates would throw.
  ensuring ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['DOM_PARSER'],
      justification: 'Parse fetched job posting HTML, which a service worker cannot do.',
    })
    .catch(async (e: unknown) => {
      // Lost a race with another caller — fine as long as the document now exists.
      if (await hasOffscreenDocument()) return;
      throw e;
    })
    .finally(() => {
      ensuring = null;
    });

  await ensuring;
}

/** Parses job HTML in the offscreen document. Returns null when it is not a job page. */
export async function parseHtmlOffscreen(html: string): Promise<ParsedJob | null> {
  await ensureOffscreenDocument();
  const res = await sendMessage({ type: 'offscreen/parse', html });
  if (!res.ok) throw res.error;
  return res.data;
}
