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
import { addHistoryEntry, getSettings, updateHistoryEntry } from '@/lib/storage';
import { analyzeJob } from '@/lib/pipeline/analyzeJob';
import { regenerateResume, tailorResume } from '@/lib/pipeline/tailorResume';
import type { JobProfile, TailorResult } from '@/lib/pipeline/types';
import { sendToTab, type OverleafDoc, type OverleafTabInfo } from '@/lib/messages';
import type { WizardState } from '@/lib/state';

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

  'overleaf/listTabs': async () => {
    const tabs = await browser.tabs.query({ url: 'https://www.overleaf.com/project/*' });
    return tabs
      .filter((t): t is typeof t & { id: number } => typeof t.id === 'number')
      .map<OverleafTabInfo>((t) => ({
        tabId: t.id,
        title: t.title ?? 'Overleaf project',
        url: t.url ?? '',
      }));
  },

  'overleaf/read': async (msg) => {
    const doc = await readOverleafDoc(msg.tabId);
    await patchState({
      resume: {
        kind: 'overleaf',
        latex: doc.latex,
        hash: doc.hash,
        filename: doc.filename,
        tabId: msg.tabId,
        readAt: new Date().toISOString(),
      },
      generation: { status: 'idle' },
    });
    return doc;
  },

  'overleaf/write': async (msg) => {
    const write = { type: 'overleaf/csWrite' as const, content: msg.content, expectedCurrentHash: msg.expectedCurrentHash };

    let res = await sendToTab(msg.tabId, write);
    if (!res.ok && res.error.code === ErrorCode.INTERNAL) {
      // Probably no content script in that tab yet rather than a real failure.
      if (await injectOverleafScripts(msg.tabId)) res = await sendToTab(msg.tabId, write);
    }
    if (!res.ok) throw res.error;

    const state = await getState();
    await patchState({ appliedAt: new Date().toISOString() });
    if (state.historyId) await updateHistoryEntry(state.historyId, { applied: true });

    return { applied: true } as const;
  },

  'pipeline/tailor': async (msg) => runGeneration(msg.notes, null),
  'pipeline/regenerate': async (msg) => {
    const state = await getState();
    if (!state.generation.result) {
      throw appError(ErrorCode.INTERNAL, 'There is no previous revision to build on.');
    }
    return runGeneration(state.notes, { previous: state.generation.result, feedback: msg.feedback });
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

/**
 * Content scripts are declared for Overleaf, but a tab opened before the
 * extension was installed or reloaded has none. Inject on demand rather than
 * making the user reload.
 */
async function injectOverleafScripts(tabId: number): Promise<boolean> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/overleaf-main.js'],
      world: 'MAIN',
    });
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/overleaf.js'],
    });
    return true;
  } catch {
    return false;
  }
}

async function readOverleafDoc(tabId: number): Promise<OverleafDoc> {
  const first = await sendToTab(tabId, { type: 'overleaf/csRead' });
  if (first.ok) return first.data;
  if (!(await injectOverleafScripts(tabId))) throw first.error;

  const second = await sendToTab(tabId, { type: 'overleaf/csRead' });
  if (!second.ok) throw second.error;
  return second.data;
}

interface RegenerationContext {
  previous: TailorResult;
  feedback: string;
}

/** Rebuilds the assistant turn so a revision can be critiqued in context. */
function asModelOutput(result: TailorResult): string {
  return `===CHANGES===\n${result.changeSummary}\n===LATEX===\n${result.latex}\n===END===`;
}

async function runGeneration(
  notes: string,
  regeneration: RegenerationContext | null,
): Promise<WizardState> {
  const state = await getState();

  if (state.generation.status === 'analyzing' || state.generation.status === 'tailoring') {
    throw appError(
      ErrorCode.ALREADY_RUNNING,
      'A revision is already being generated. Wait for it to finish.',
    );
  }
  if (!state.job) throw appError(ErrorCode.INTERNAL, 'Capture a job posting first.');
  if (!state.resume) throw appError(ErrorCode.INTERNAL, 'Load your resume first.');

  const runId = `run-${Date.now()}`;
  const startedAt = new Date().toISOString();

  try {
    const { provider, model, meta } = await getActiveProvider();

    // The profile is normally produced on the job step; analyze on demand if not.
    let profile: JobProfile | undefined = state.jobProfile;
    if (!profile) {
      await patchState({ generation: { status: 'analyzing', runId, startedAt } });
      profile = await analyzeJob(provider, model, state.job);
      await patchState({ jobProfile: profile });
    }

    await patchState({ notes, generation: { status: 'tailoring', runId, startedAt } });

    const input = { provider, model, profile, notes, latex: state.resume.latex };
    const result = regeneration
      ? await regenerateResume(input, asModelOutput(regeneration.previous), regeneration.feedback)
      : await tailorResume(input);

    const historyId = crypto.randomUUID();
    await addHistoryEntry({
      id: historyId,
      timestamp: new Date().toISOString(),
      job: state.job,
      jobProfile: profile,
      originalLatex: state.resume.latex,
      revisedLatex: result.latex,
      changeSummary: result.changeSummary,
      applied: false,
      providerId: meta.id,
      model,
    });

    return patchState({
      step: 'review',
      historyId,
      appliedAt: undefined,
      generation: { status: 'done', runId, startedAt, result },
    });
  } catch (e) {
    const error = toAppError(e);
    await patchState({ generation: { status: 'error', runId, startedAt, error } });
    throw error;
  }
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

/**
 * A generation lives inside this worker. If the worker was evicted mid-run the
 * work is gone, so a status left at "running" on startup is stale, not live.
 */
async function recoverInterruptedRun(): Promise<void> {
  const state = await getState();
  if (state.generation.status !== 'analyzing' && state.generation.status !== 'tailoring') return;

  await patchState({
    generation: {
      ...state.generation,
      status: 'error',
      error: appError(
        ErrorCode.GENERATION_INTERRUPTED,
        'The last generation was interrupted before it finished.',
        'Chrome shut the extension down mid-run. Press Generate again.',
      ),
    },
  });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    console.info('[skillo] installed:', details.reason);
  });

  void recoverInterruptedRun();

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
