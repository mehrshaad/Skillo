import { browser, type Browser } from 'wxt/browser';
import { ErrorCode, toAppError, appError } from '@/lib/errors';
import type { Message, MessageMap, MessageOf, MessageType, Result } from '@/lib/messages';
import { ok, fail } from '@/lib/messages';
import { getState, patchState, resetState } from '@/lib/state';
import {
  buildManualPosting,
  extractFromActiveTab,
  fetchJobFromUrl,
} from '@/lib/jobIntake/fetchJob';
import type { JobPosting } from '@/lib/jobIntake/types';
import { buildProvider, getActiveProvider } from '@/lib/providers/registry';
import { getSettings } from '@/lib/storage';
import { analyzeJob } from '@/lib/pipeline/analyzeJob';

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

  'job/fetch': async (msg) => acceptJob(await fetchJobFromUrl(msg.url)),
  'job/useActiveTab': async () => acceptJob(await extractFromActiveTab()),
  'job/manual': async (msg) => acceptJob(buildManualPosting(msg.url, msg.text)),

  'provider/test': async (msg) => {
    const { provider } = buildProvider(msg.providerId, await getSettings());
    await provider.test();
    return { ok: true } as const;
  },

  'provider/listModels': async (msg) => {
    const { provider, meta } = buildProvider(msg.providerId, await getSettings());
    if (!provider.listModels) {
      throw appError(
        ErrorCode.PROVIDER_REQUEST_FAILED,
        `${meta.label} does not publish a model list. Type the model id instead.`,
      );
    }
    return provider.listModels();
  },

  'pipeline/analyze': async () => {
    const state = await getState();
    if (!state.job) {
      throw appError(ErrorCode.INTERNAL, 'Capture a job posting first.');
    }

    await patchState({ generation: { status: 'analyzing', startedAt: new Date().toISOString() } });
    try {
      const { provider, model } = await getActiveProvider();
      const jobProfile = await analyzeJob(provider, model, state.job);
      return patchState({ jobProfile, generation: { status: 'idle' } });
    } catch (e) {
      await patchState({ generation: { status: 'error', error: toAppError(e) } });
      throw e;
    }
  },
};

/**
 * A new job invalidates any analysis and generated revision made for the old one.
 */
async function acceptJob(job: JobPosting): Promise<JobPosting> {
  await patchState({
    job,
    jobProfile: undefined,
    generation: { status: 'idle' },
    appliedAt: undefined,
    historyId: undefined,
    step: 'job',
  });
  return job;
}

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
    // runtime.sendMessage broadcasts to every extension context. Offscreen
    // messages belong to the offscreen document; answering them here would race
    // it and win with an error.
    if ((msg as { type?: string })?.type?.startsWith('offscreen/')) return false;

    route(msg as Message, sender).then(sendResponse);
    return true; // keep the channel open for the async response
  });
});
