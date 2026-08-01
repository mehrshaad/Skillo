import { browser, type Browser } from 'wxt/browser';
import type { AppError } from './errors';
import type { JobPosting } from './jobIntake/types';
import type { JobProfile, MatchScore, TailorResult } from './pipeline/types';

export type WizardStep = 'job' | 'resume' | 'tailor' | 'review';

export type GenerationStatus =
  | 'idle'
  | 'analyzing'
  | 'tailoring'
  | 'validating'
  | 'done'
  | 'error';

export interface ResumeSource {
  kind: 'overleaf' | 'paste' | 'upload';
  latex: string;
  hash: string;
  filename?: string;
  /** Set for kind === 'overleaf'; the tab the document was read from. */
  tabId?: number;
  readAt: string;
}

export interface GenerationState {
  status: GenerationStatus;
  /** Identifies one Generate press; used for the single-flight lock and stale-run recovery. */
  runId?: string;
  startedAt?: string;
  error?: AppError;
  result?: TailorResult;
  /** Absent when scoring failed or was skipped — never blocks a run. */
  match?: MatchScore;
}

/** 1 = change as little as possible, 5 = rewrite hard for this job. */
export type FitLevel = 1 | 2 | 3 | 4 | 5;
export type PageLimit = 1 | 2 | 3;

export interface WizardState {
  step: WizardStep;
  job?: JobPosting;
  jobProfile?: JobProfile;
  resume?: ResumeSource;
  notes: string;
  fitLevel: FitLevel;
  pageLimit: PageLimit;
  fillLastPage: boolean;
  generation: GenerationState;
  /** Set once the revision has been written into Overleaf. */
  appliedAt?: string;
  /** History entry created for the current generation, so Apply can flip its flag. */
  historyId?: string;
}

export const INITIAL_STATE: WizardState = {
  step: 'job',
  notes: '',
  fitLevel: 3,
  pageLimit: 2,
  fillLastPage: false,
  generation: { status: 'idle' },
};

const STATE_KEY = 'wizard';

/**
 * Wizard state lives in session storage: it must survive the panel being closed
 * and the MV3 service worker being evicted, but should not outlive the browser.
 */
/** null when nothing has been stored yet, so callers can seed first-run values. */
export async function getStoredState(): Promise<WizardState | null> {
  const raw = await browser.storage.session.get(STATE_KEY);
  const stored = raw[STATE_KEY] as WizardState | undefined;
  return stored ? { ...INITIAL_STATE, ...stored } : null;
}

export async function getState(): Promise<WizardState> {
  return (await getStoredState()) ?? INITIAL_STATE;
}

export async function setState(next: WizardState): Promise<WizardState> {
  await browser.storage.session.set({ [STATE_KEY]: next });
  return next;
}

export async function patchState(patch: Partial<WizardState>): Promise<WizardState> {
  const current = await getState();
  return setState({ ...current, ...patch });
}

export async function resetState(): Promise<WizardState> {
  return setState(INITIAL_STATE);
}

/** Notifies the panel of state changes without a polling loop. */
export function onStateChange(cb: (state: WizardState) => void): () => void {
  const listener = (
    changes: Record<string, Browser.storage.StorageChange>,
    area: string,
  ) => {
    const change = changes[STATE_KEY];
    if (area !== 'session' || !change) return;
    cb(change.newValue as WizardState);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
