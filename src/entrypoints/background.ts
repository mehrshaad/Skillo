import { browser, type Browser } from 'wxt/browser';
import { ErrorCode, toAppError, appError } from '@/lib/errors';
import type { Message, MessageMap, MessageOf, MessageType, Result } from '@/lib/messages';
import { ok, fail } from '@/lib/messages';
import { getState, patchState, resetState } from '@/lib/state';

type Handler<K extends MessageType> = (
  msg: MessageOf<K>,
  sender: Browser.runtime.MessageSender,
) => Promise<MessageMap[K]['res']>;

type HandlerMap = { [K in MessageType]?: Handler<K> };

/**
 * Handlers throw AppError (or anything); the router below converts to Result so
 * nothing crosses the message boundary as a rejection. Milestones register more
 * handlers here as features land.
 */
const handlers: HandlerMap = {
  'state/get': async () => getState(),
  'state/update': async (msg) => patchState(msg.patch),
  'state/reset': async () => resetState(),
};

async function route(
  msg: Message,
  sender: Browser.runtime.MessageSender,
): Promise<Result<unknown>> {
  const handler = handlers[msg.type] as Handler<MessageType> | undefined;
  if (!handler) {
    return fail(
      appError(ErrorCode.UNKNOWN_MESSAGE, `No handler for message "${msg.type}".`),
    );
  }
  try {
    return ok(await handler(msg, sender));
  } catch (e) {
    return fail(toAppError(e));
  }
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    console.info('[skillo] installed:', details.reason);
  });

  // Clicking the toolbar icon opens the side panel. Chrome 116+.
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e: unknown) => console.error('[skillo] setPanelBehavior failed', e));

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    route(msg as Message, sender).then(sendResponse);
    return true; // keep the channel open for the async response
  });
});
