import { browser } from 'wxt/browser';
import { toAppError } from '@/lib/errors';
import { fail, ok } from '@/lib/messages';
import { parseJobDocument } from '@/lib/jobIntake/parseJobHtml';

/**
 * MV3 service workers have no DOMParser, so HTML fetched in the background is
 * parsed here. Kept to exactly one job: string in, ParsedJob out.
 */
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const message = msg as { type?: string; html?: string };
  if (message?.type !== 'offscreen/parse') return false;

  try {
    const doc = new DOMParser().parseFromString(message.html ?? '', 'text/html');
    sendResponse(ok(parseJobDocument(doc)));
  } catch (e) {
    sendResponse(fail(toAppError(e)));
  }
  return true;
});
