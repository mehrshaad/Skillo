import { browser } from 'wxt/browser';
import type { AppError } from './errors';
import { ErrorCode, appError } from './errors';
import type { JobPosting, ParsedJob } from './jobIntake/types';
import type { WizardState } from './state';
import type { ModelInfo, ProviderId } from './providers/types';
import type { BridgeStatus } from './providers/claudeCode';
import { injectScriptsFor } from './tabScripts';

export interface OverleafTabInfo {
  tabId: number;
  title: string;
  url: string;
}

export interface OverleafDoc {
  latex: string;
  hash: string;
  filename?: string;
}

/**
 * Single source of truth for every runtime message. `req` is spread onto
 * `{ type }`; `res` is what the sender receives inside `Result<T>`.
 */
export interface MessageMap {
  // panel -> background
  'job/fetch': { req: { url: string }; res: JobPosting };
  'job/useActiveTab': { req: {}; res: JobPosting };
  'job/manual': { req: { url: string; text: string }; res: JobPosting };
  'overleaf/listTabs': { req: {}; res: OverleafTabInfo[] };
  'overleaf/read': { req: { tabId: number }; res: OverleafDoc };
  'overleaf/write': {
    req: { tabId: number; content: string; expectedCurrentHash: string };
    res: { applied: true };
  };
  /** null when the project has not been compiled or the PDF pane is closed. */
  'overleaf/pageCount': { req: { tabId: number }; res: { pages: number | null } };
  /**
   * The user read the real fill off the compiled page. Worth more than a page
   * count, because a fraction pins the capacity instead of bounding it.
   */
  'density/report': { req: { actualPages: number; of: 'resume' | 'revision' }; res: { ok: true } };
  'pipeline/analyze': { req: {}; res: WizardState };
  'pipeline/tailor': { req: { notes: string }; res: WizardState };
  'pipeline/regenerate': { req: { feedback: string }; res: WizardState };
  'provider/test': { req: { providerId: ProviderId }; res: { ok: true } };
  'bridge/status': { req: {}; res: BridgeStatus };
  'provider/listModels': { req: { providerId: ProviderId }; res: ModelInfo[] };
  'state/get': { req: {}; res: WizardState };
  'state/update': { req: { patch: Partial<WizardState> }; res: WizardState };
  'state/reset': { req: {}; res: WizardState };

  // background -> offscreen document (service workers have no DOMParser)
  'offscreen/parse': { req: { html: string }; res: ParsedJob | null };

  // background -> content script
  'job/extractFromDom': { req: {}; res: ParsedJob };
  'overleaf/csRead': { req: {}; res: OverleafDoc };
  'overleaf/csWrite': {
    req: { content: string; expectedCurrentHash: string };
    res: { applied: true };
  };
  'overleaf/csPageCount': { req: {}; res: { pages: number | null } };
}

export type MessageType = keyof MessageMap;

export type Message = {
  [K in MessageType]: { type: K } & MessageMap[K]['req'];
}[MessageType];

export type MessageOf<K extends MessageType> = { type: K } & MessageMap[K]['req'];

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };
export type ResponseFor<K extends MessageType> = Result<MessageMap[K]['res']>;

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (error: AppError): Result<never> => ({ ok: false, error });

/** Panel/content-script -> background. Never throws; transport failures come back as Result. */
export async function sendMessage<K extends MessageType>(
  msg: MessageOf<K>,
): Promise<ResponseFor<K>> {
  try {
    const res = await browser.runtime.sendMessage(msg);
    if (!res) {
      return fail(
        appError(ErrorCode.INTERNAL, 'No response from the extension background worker.'),
      );
    }
    return res as ResponseFor<K>;
  } catch (e) {
    return fail(
      appError(
        ErrorCode.INTERNAL,
        'Could not reach the extension background worker.',
        e instanceof Error ? e.message : String(e),
      ),
    );
  }
}

/** Chrome's wording when nothing in that tab is listening. */
const NO_LISTENER = /receiving end does not exist|could not establish connection/i;

interface Attempt<K extends MessageType> {
  result: ResponseFor<K>;
  /** True only for "nothing is listening", which injecting can fix. */
  noListener: boolean;
}

async function postToTab<K extends MessageType>(
  tabId: number,
  msg: MessageOf<K>,
): Promise<Attempt<K>> {
  try {
    const res = await browser.tabs.sendMessage(tabId, msg);
    if (!res) {
      return {
        result: fail(appError(ErrorCode.INTERNAL, 'No response from the page.')),
        noListener: false,
      };
    }
    return { result: res as ResponseFor<K>, noListener: false };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      result: fail(appError(ErrorCode.INTERNAL, 'Could not reach the page.', detail)),
      noListener: NO_LISTENER.test(detail),
    };
  }
}

/**
 * Background -> a specific tab's content script.
 *
 * A tab opened before the extension loaded has no content script in it, because
 * MV3 injects only at navigation time. Instead of surfacing that as a failure,
 * inject on demand and try once more. One retry, never a loop: if the script
 * still is not there, injecting again will not help.
 */
export async function sendToTab<K extends MessageType>(
  tabId: number,
  msg: MessageOf<K>,
): Promise<ResponseFor<K>> {
  const first = await postToTab<K>(tabId, msg);
  if (!first.noListener) return first.result;

  if (await injectScriptsFor(msg.type, tabId)) {
    const second = await postToTab<K>(tabId, msg);
    if (!second.noListener) return second.result;
  }

  return fail(
    appError(
      ErrorCode.INTERNAL,
      'Skillo could not reach that page.',
      'Reload the tab and try again. If this is not the LinkedIn or Overleaf page you meant, open that one first.',
    ),
  );
}
