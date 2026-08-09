import { browser } from 'wxt/browser';
import { toAppError } from '@/core/errors';
import { fail, ok } from '@/lib/messages';
import { extractFromLivePage } from '@/lib/jobIntake/domExtract';
import { observeAndMount } from '@/lib/jobIntake/injectButton';

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

    // Not awaited: sidePanel.open needs the user gesture, and awaiting anything
    // here would spend it before the worker got the chance.
    observeAndMount(document, () => {
      void browser.runtime.sendMessage({ type: 'panel/openWithJob', url: location.href });
    });
  },
});
