import { browser, type Browser } from 'wxt/browser';
import type { AppError } from './errors';
import type { JobPosting } from './jobIntake/types';
import type { JobProfile, TailorResult } from './pipeline/types';

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
}

export interface WizardState {
  step: WizardStep;
  job?: JobPosting;
  jobProfile?: JobProfile;
  resume?: ResumeSource;
  notes: string;
  generation: GenerationState;
  /** Set once the revision has been written into Overleaf. */
  appliedAt?: string;
  /** History entry created for the current generation, so Apply can flip its flag. */
  historyId?: string;
}

export const INITIAL_STATE: WizardState = {
  step: 'job',
  notes: '',
  generation: { status: 'idle' },
};

const STATE_KEY = 'wizard';

/**
 * Wizard state lives in session storage: it must survive the panel being closed
 * and the MV3 service worker being evicted, but should not outlive the browser.
 */
export async function getState(): Promise<WizardState> {
  const raw = await browser.storage.session.get(STATE_KEY);
  const stored = raw[STATE_KEY] as WizardState | undefined;
  if (!stored) return INITIAL_STATE;
  return { ...INITIAL_STATE, ...stored };
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
