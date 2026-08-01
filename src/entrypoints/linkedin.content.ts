import { browser } from 'wxt/browser';
import { toAppError } from '@/lib/errors';
import { fail, ok } from '@/lib/messages';
import { extractFromLivePage } from '@/lib/jobIntake/domExtract';

export default defineContentScript({
  matches: ['*://*.linkedin.com/*'],
  main() {
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if ((msg as { type?: string })?.type !== 'job/extractFromDom') return false;

      try {
        sendResponse(ok(extractFromLivePage(document)));
      } catch (e) {
        sendResponse(fail(toAppError(e)));
      }
      return true;
    });
  },
});
