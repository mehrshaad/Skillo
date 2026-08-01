import { browser } from 'wxt/browser';
import type { ProviderId } from './providers/types';
import type { JobPosting } from './jobIntake/types';
import type { JobProfile } from './pipeline/types';
import type { FitLevel, PageLimit } from './state';

export interface ProviderConfig {
  apiKey: string;
  model: string;
}

/** Last-used generation controls, so the next run starts where the user left off. */
export interface GenerationDefaults {
  fitLevel?: FitLevel;
  pageLimit?: PageLimit;
  fillLastPage?: boolean;
}

export interface Settings {
  activeProviderId: ProviderId | null;
  defaults?: GenerationDefaults;
  providers: {
    openrouter?: ProviderConfig;
    openai?: ProviderConfig;
    anthropic?: ProviderConfig;
    claudeCode?: { enabled: boolean };
  };
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  job: JobPosting;
  jobProfile: JobProfile;
  originalLatex: string;
  revisedLatex: string;
  changeSummary: string;
  applied: boolean;
  providerId: ProviderId;
  model: string;
  fitLevel?: FitLevel;
  pageLimit?: PageLimit;
}

export const DEFAULT_SETTINGS: Settings = {
  activeProviderId: null,
  providers: {},
};

const SETTINGS_KEY = 'settings';
const HISTORY_KEY = 'history';
const HISTORY_LIMIT = 20;

export async function getSettings(): Promise<Settings> {
  const raw = await browser.storage.local.get(SETTINGS_KEY);
  const stored = raw[SETTINGS_KEY] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    providers: { ...DEFAULT_SETTINGS.providers, ...stored?.providers },
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    ...current,
    ...patch,
    providers: { ...current.providers, ...patch.providers },
  };
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const raw = await browser.storage.local.get(HISTORY_KEY);
  return (raw[HISTORY_KEY] as HistoryEntry[] | undefined) ?? [];
}

export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  const history = await getHistory();
  const next = [entry, ...history].slice(0, HISTORY_LIMIT);
  await browser.storage.local.set({ [HISTORY_KEY]: next });
}

export async function updateHistoryEntry(
  id: string,
  patch: Partial<HistoryEntry>,
): Promise<void> {
  const history = await getHistory();
  const next = history.map((e) => (e.id === id ? { ...e, ...patch } : e));
  await browser.storage.local.set({ [HISTORY_KEY]: next });
}

export async function clearHistory(): Promise<void> {
  await browser.storage.local.remove(HISTORY_KEY);
}
