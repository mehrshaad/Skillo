import { browser } from 'wxt/browser';
import { ErrorCode, appError, toAppError } from '@/lib/errors';
import { fail, ok, type OverleafDoc } from '@/lib/messages';
import {
  OVERLEAF_ORIGIN,
  REQUEST_SOURCE,
  isResponseMessage,
  type OverleafOp,
} from '@/lib/overleaf/protocol';

const RPC_TIMEOUT_MS = 5_000;
let nextId = 0;

/**
 * Bridges extension messages to the MAIN-world script, which is the only side
 * that can touch CodeMirror. Correlates by id so concurrent calls cannot cross.
 */
function callMainWorld(payload: OverleafOp): Promise<OverleafDoc | { applied: true }> {
  return new Promise((resolve, reject) => {
    const id = `skillo-${nextId++}`;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== OVERLEAF_ORIGIN) return;
      if (!isResponseMessage(event.data) || event.data.id !== id) return;

      cleanup();
      const { result } = event.data;
      if (result.ok) resolve(result.data);
      else reject(result.error);
    };

    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        appError(
          ErrorCode.OVERLEAF_EDITOR_NOT_FOUND,
          'The Overleaf page did not respond.',
          'Reload the Overleaf tab and try again.',
        ),
      );
    }, RPC_TIMEOUT_MS);

    window.addEventListener('message', onMessage);
    window.postMessage({ source: REQUEST_SOURCE, id, payload }, OVERLEAF_ORIGIN);
  });
}

export default defineContentScript({
  matches: ['https://www.overleaf.com/project/*'],
  main() {
    browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      const type = (msg as { type?: string })?.type;
      if (type !== 'overleaf/csRead') return false;

      callMainWorld({ op: 'read' })
        .then((data) => sendResponse(ok(data as OverleafDoc)))
        .catch((e: unknown) => sendResponse(fail(toAppError(e))));
      return true;
    });
  },
});
