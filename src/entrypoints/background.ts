import { browser, type Browser } from 'wxt/browser';
import { ErrorCode, toAppError, appError } from '@/core/errors';
import type { Message, MessageMap, MessageOf, MessageType, Result } from '@/lib/messages';
import { ok, fail } from '@/lib/messages';
import { INITIAL_STATE, getState, getStoredState, patchState, resetState, setState } from '@/lib/state';
import {
  buildManualPosting,
  extractFromActiveTab,
  fetchJobFromUrl,
} from '@/lib/jobIntake/fetchJob';
import type { JobPosting } from '@/core/jobIntake/types';
import { buildProvider, getActiveProvider } from '@/lib/providers/registry';
import { getBridgeStatus } from '@/lib/providers/claudeCode';
import {
  addHistoryEntry,
  getHistory,
  getSettings,
  saveSettings,
  updateHistoryEntry,
} from '@/lib/storage';
import { hashText } from '@/core/hash';
import { computePageBudget } from '@/core/pipeline/pageBudget';
import { getDensityModel, recordObservation } from '@/lib/pipeline/densityStore';
import { getProfile } from '@/lib/profileStore';
import { analyzeJob } from '@/core/pipeline/analyzeJob';
import {
  critiqueRevision,
  regenerateResume,
  reviseFromCritique,
  tailorResume,
} from '@/core/pipeline/tailorResume';
import { chatAboutResume, type ChatTurn } from '@/core/pipeline/chat';
import { writeCoverLetter } from '@/core/pipeline/coverLetter';
import { scoreMatch } from '@/core/pipeline/scoreMatch';
import { atsScore } from '@/core/pipeline/atsScore';
import { latexToPlainText } from '@/core/latexText';
import type { JobProfile, MatchScore, TailorResult } from '@/core/pipeline/types';
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
  'state/get': async () => {
    const stored = await getStoredState();
    return stored ?? setState({ ...INITIAL_STATE, ...(await generationDefaults()) });
  },
  'state/update': async (msg) => patchState(msg.patch),
  'state/reset': async () => {
    await resetState();
    return patchState(await generationDefaults());
  },

  /**
   * Puts a past run back on the review screen. The resume comes back as pasted
   * text rather than an Overleaf source: the tab it was read from is long gone,
   * and writing into a document we cannot verify is exactly what the apply
   * guard exists to prevent. Re-pick the project on the resume step to apply.
   */
  'history/reopen': async (msg) => {
    const entry = (await getHistory()).find((e) => e.id === msg.id);
    if (!entry) {
      throw appError(ErrorCode.INTERNAL, 'That run is no longer in your history.');
    }

    const current = await getState();
    return patchState({
      step: 'review',
      job: entry.job,
      jobProfile: entry.jobProfile,
      historyId: entry.id,
      appliedAt: undefined,
      fitLevel: entry.fitLevel ?? current.fitLevel,
      pageLimit: entry.pageLimit ?? current.pageLimit,
      resume: {
        kind: 'paste',
        latex: entry.originalLatex,
        readAt: entry.timestamp,
      },
      generation: {
        status: 'done',
        result: { latex: entry.revisedLatex, changeSummary: entry.changeSummary },
        match: entry.match,
        ats: entry.ats,
      },
    });
  },

  'job/fetch': async (msg) => acceptJob(await fetchJobFromUrl(msg.url)),
  'job/useActiveTab': async () => acceptJob(await extractFromActiveTab()),
  'job/manual': async (msg) => acceptJob(buildManualPosting(msg.url, msg.text)),

  'bridge/status': async () => getBridgeStatus(),

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

    // A document we can see, whose compiled page count we can also see, is a
    // free lesson about how much this template fits on a page.
    const { pages } = await readOverleafPageCount(msg.tabId);
    if (pages !== null) await recordObservation(doc.latex, pages);

    await patchState({
      resume: {
        kind: 'overleaf',
        latex: doc.latex,
        overleafDocHash: doc.hash,
        locallyEdited: false,
        filename: doc.filename,
        tabId: msg.tabId,
        readAt: new Date().toISOString(),
      },
      generation: { status: 'idle' },
    });
    return doc;
  },

  'overleaf/write': async (msg) => {
    const res = await sendToTab(msg.tabId, {
      type: 'overleaf/csWrite',
      content: msg.content,
      expectedCurrentHash: msg.expectedCurrentHash,
    });
    if (!res.ok) throw res.error;

    const state = await getState();

    // The document now *is* what we just wrote, so that becomes the baseline:
    // the next diff compares against it, regenerating builds on it, and the
    // stale-document guard compares against it. Without this, a second apply
    // always failed with OVERLEAF_DOC_CHANGED — the guard was still holding the
    // hash of the document as it looked before the first apply.
    await patchState({
      appliedAt: new Date().toISOString(),
      resume: state.resume
        ? {
            ...state.resume,
            latex: msg.content,
            overleafDocHash: hashText(msg.content),
            locallyEdited: false,
          }
        : undefined,
    });

    if (state.historyId) await updateHistoryEntry(state.historyId, { applied: true });

    return { applied: true } as const;
  },

  'overleaf/compile': async (msg) => {
    const res = await sendToTab(msg.tabId, { type: 'overleaf/csCompile' });
    if (!res.ok) throw res.error;

    // A fresh compile is the most informative density observation there is,
    // because it is the text Skillo just wrote.
    if (res.data.outcome === 'compiled') {
      const { pages } = await readOverleafPageCount(msg.tabId);
      const state = await getState();
      const latex = state.generation.result?.latex ?? state.resume?.latex;
      if (pages !== null && latex) await recordObservation(latex, pages);
    }
    return res.data;
  },

  'overleaf/downloadPdf': async (msg) => {
    const res = await sendToTab(msg.tabId, { type: 'overleaf/csDownloadPdf' });
    if (!res.ok) throw res.error;
    return res.data;
  },

  'overleaf/pageCount': async (msg) => {
    const result = await readOverleafPageCount(msg.tabId);

    // The applied revision just compiled: that is the most informative
    // observation there is, because it is the text we generated.
    const state = await getState();
    if (result.pages !== null && state.generation.result) {
      await recordObservation(state.generation.result.latex, result.pages);
    }
    return result;
  },

  'density/report': async (msg) => {
    const state = await getState();
    const latex =
      msg.of === 'revision' ? state.generation.result?.latex : state.resume?.latex;

    if (!latex) {
      throw appError(ErrorCode.INTERNAL, 'There is nothing to measure against yet.');
    }
    await recordObservation(latex, msg.actualPages, true);
    return { ok: true } as const;
  },

  'pipeline/coverLetter': async () => {
    const state = await getState();
    if (!state.jobProfile || !state.generation.result) {
      throw appError(ErrorCode.INTERNAL, 'Generate a resume before writing a letter for it.');
    }

    const { provider, model } = await getActiveProvider();
    const letter = await writeCoverLetter({
      provider,
      model,
      job: state.jobProfile,
      latex: state.generation.result.latex,
      notes: state.notes,
      candidate: await getProfile(),
    });
    return { letter };
  },

  /**
   * The conversation lives on the history entry rather than in wizard state, so
   * it is still there when the run is reopened weeks later.
   */
  'chat/send': async (msg) => {
    const state = await getState();
    const result = state.generation.result;
    if (!state.jobProfile || !result || !state.resume) {
      throw appError(ErrorCode.INTERNAL, 'There is no revision to talk about yet.');
    }

    const entry = state.historyId
      ? (await getHistory()).find((e) => e.id === state.historyId)
      : undefined;
    const turns = entry?.chat ?? [];

    const { provider, model } = await getActiveProvider();
    const densityModel = await getDensityModel(state.resume.latex);

    const reply = await chatAboutResume({
      provider,
      model,
      job: state.jobProfile,
      latex: result.latex,
      originalLatex: state.resume.latex,
      budget: computePageBudget(state.pageLimit, state.fillLastPage, densityModel),
      match: state.generation.match,
      ats: state.generation.ats,
      candidate: await getProfile(),
      turns,
      message: msg.message,
    });

    const now = new Date().toISOString();
    const next: ChatTurn[] = [
      ...turns,
      { role: 'user', content: msg.message, at: now },
      {
        role: 'assistant',
        content: reply.text,
        ...(reply.latex ? { latex: reply.latex } : {}),
        ...(reply.validationErrors ? { validationErrors: reply.validationErrors } : {}),
        at: now,
      },
    ];

    if (state.historyId) await updateHistoryEntry(state.historyId, { chat: next });
    return { turns: next };
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

/** The generation controls a run starts with: whatever the last run used. */
async function generationDefaults(): Promise<Partial<WizardState>> {
  const { defaults } = await getSettings();
  return {
    fitLevel: defaults?.fitLevel ?? INITIAL_STATE.fitLevel,
    pageLimit: defaults?.pageLimit ?? INITIAL_STATE.pageLimit,
    fillLastPage: defaults?.fillLastPage ?? INITIAL_STATE.fillLastPage,
    highEffort: defaults?.highEffort ?? INITIAL_STATE.highEffort,
  };
}

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

async function readOverleafDoc(tabId: number): Promise<OverleafDoc> {
  // sendToTab injects the content scripts itself when the tab has none.
  const res = await sendToTab(tabId, { type: 'overleaf/csRead' });
  if (!res.ok) throw res.error;
  return res.data;
}

/**
 * Never throws: an unreadable page count is a normal outcome (not compiled yet,
 * PDF pane closed) and callers treat null as "estimate instead".
 */
async function readOverleafPageCount(tabId: number): Promise<{ pages: number | null }> {
  const res = await sendToTab(tabId, { type: 'overleaf/csPageCount' });
  return res.ok ? res.data : { pages: null };
}

/**
 * Writes the revision straight into Overleaf when the user has asked for that,
 * and recompiles it.
 *
 * Deliberately timid, because this is the one destructive thing Skillo does:
 * off unless switched on, never on a revision that failed validation, never on
 * a resume that did not come from an Overleaf tab, and it reuses the existing
 * stale-document guard rather than a looser one of its own. Any refusal is
 * silent — the review screen is right there with a working Apply button.
 */
async function autoApply(state: WizardState, historyId: string): Promise<WizardState> {
  const { autoApply: enabled, autoCompile } = await getSettings();
  const result = state.generation.result;
  const resume = state.resume;

  if (!enabled || !result || result.validationErrors?.length) return state;
  if (resume?.kind !== 'overleaf' || resume.tabId === undefined) return state;

  const written = await sendToTab(resume.tabId, {
    type: 'overleaf/csWrite',
    content: result.latex,
    expectedCurrentHash: resume.overleafDocHash ?? '',
  });
  if (!written.ok) return state;

  const applied = await patchState({
    appliedAt: new Date().toISOString(),
    resume: {
      ...resume,
      latex: result.latex,
      overleafDocHash: hashText(result.latex),
      locallyEdited: false,
    },
  });
  await updateHistoryEntry(historyId, { applied: true });

  if (autoCompile !== false) {
    const compiled = await sendToTab(resume.tabId, { type: 'overleaf/csCompile' });
    if (compiled.ok && compiled.data.outcome === 'compiled') {
      const { pages } = await readOverleafPageCount(resume.tabId);
      if (pages !== null) await recordObservation(result.latex, pages);
    }
  }

  return applied;
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

  // Show the step that reports progress. Regenerating is triggered from the
  // review screen, so without this the user watches a stale diff and cannot
  // tell whether anything is happening.
  await patchState({ step: 'tailor' });

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

    // Budget from what compiled page counts have taught us about this template.
    // Falls back to the constant until the first observation lands.
    const densityModel = await getDensityModel(state.resume.latex);
    const budget = computePageBudget(state.pageLimit, state.fillLastPage, densityModel);

    const input = {
      provider,
      model,
      profile,
      notes,
      candidate: await getProfile(),
      latex: state.resume.latex,
      fitLevel: state.fitLevel,
      budget,
    };
    const draft = regeneration
      ? await regenerateResume(input, asModelOutput(regeneration.previous), regeneration.feedback)
      : await tailorResume(input);

    // Draft, critique, revise. The critique is where an invented claim gets
    // caught, because it is the only pass reading the rewrite against the
    // original with fresh instructions. Both extra passes are additive: if
    // either fails, the draft still stands rather than the run being lost.
    let result = draft;
    if (state.highEffort && !draft.validationErrors?.length) {
      await patchState({ generation: { status: 'critiquing', runId, startedAt } });
      const critique = await critiqueRevision(input, draft);

      if (critique) {
        await patchState({ generation: { status: 'revising', runId, startedAt } });
        try {
          result = await reviseFromCritique(input, draft, critique);
        } catch (e) {
          console.warn('[skillo] revision pass failed; keeping the draft', e);
        }
      }
    }

    // Scoring is additive: a failure here must not lose a good revision.
    let match: MatchScore | undefined;
    try {
      match = await scoreMatch(provider, model, profile, state.resume.latex, result.latex);
    } catch (e) {
      console.warn('[skillo] match scoring failed; continuing without a score', e);
    }

    // Keyword coverage is counted locally, so it costs nothing and cannot fail
    // the run. Both versions are scored so the delta is real.
    const beforeAts = atsScore(profile, latexToPlainText(state.resume.latex));
    const afterAts = atsScore(profile, latexToPlainText(result.latex));
    const ats = beforeAts && afterAts ? { before: beforeAts, after: afterAts } : undefined;

    // Remember the controls so the next run starts where this one left off.
    await saveSettings({
      defaults: {
        fitLevel: state.fitLevel,
        pageLimit: state.pageLimit,
        fillLastPage: state.fillLastPage,
        highEffort: state.highEffort,
      },
    });

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
      fitLevel: state.fitLevel,
      pageLimit: state.pageLimit,
      match,
      ats,
    });

    const next = await patchState({
      step: 'review',
      historyId,
      appliedAt: undefined,
      generation: { status: 'done', runId, startedAt, result, match, ats, budget },
    });

    return autoApply(next, historyId);
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
