import { browser } from 'wxt/browser';
import type { ProviderConfig, ProviderId } from '@/core/providers/types';
import type { JobPosting } from '@/core/jobIntake/types';
import type { JobProfile, MatchScore } from '@/core/pipeline/types';
import type { AtsResult } from '@/core/pipeline/atsScore';
import type { ChatTurn } from '@/core/pipeline/chat';
import type { FitLevel, PageLimit } from './state';

export type { ProviderConfig };

/** Last-used generation controls, so the next run starts where the user left off. */
export interface GenerationDefaults {
  fitLevel?: FitLevel;
  pageLimit?: PageLimit;
  fillLastPage?: boolean;
  highEffort?: boolean;
}

/** Panel preferences worth remembering, small enough to sync. */
export interface UiPrefs {
  matchExpanded?: boolean;
  atsExpanded?: boolean;
  changesExpanded?: boolean;
  /** When the first-run tour was dismissed. Synced, so a second machine skips it. */
  tourDoneAt?: string;
}

export interface Settings {
  activeProviderId: ProviderId | null;
  /** Write a finished revision into Overleaf without waiting to be asked. Off by default. */
  autoApply?: boolean;
  /** Press Recompile after applying. Harmless, so it defaults on once autoApply is. */
  autoCompile?: boolean;
  defaults?: GenerationDefaults;
  ui?: UiPrefs;
  providers: {
    openrouter?: ProviderConfig;
    openai?: ProviderConfig;
    anthropic?: ProviderConfig;
    huggingface?: ProviderConfig;
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
  match?: MatchScore;
  ats?: { before: AtsResult; after: AtsResult };
  /** Kept regardless of the cap. */
  starred?: boolean;
  /** A name the user gave this run, shown instead of the job title. */
  label?: string;
  /** Anything worth remembering about it: who referred you, what you said. */
  note?: string;
  /** The coaching conversation about this run, so it survives closing the panel. */
  chat?: ChatTurn[];
}

export const DEFAULT_SETTINGS: Settings = {
  activeProviderId: null,
  providers: {},
};

/*
 * Settings live in two places on purpose.
 *
 *   chrome.storage.sync  — choices worth carrying between machines. Small.
 *   chrome.storage.local — API keys, and everything too big to sync.
 *
 * Keys never sync. storage.sync round-trips through Google's servers, and a
 * convenience feature is not worth putting someone's provider credentials
 * there. The cost is that a second machine asks for keys once, which is the
 * right trade.
 *
 * storage.sync also caps items at 8 KB, so history and wizard state could not
 * sync even if we wanted them to.
 */
const SYNCED_KEY = 'settings';
const SECRETS_KEY = 'secrets';
/** Pre-split blob: the whole of Settings, including keys, in local. */
const LEGACY_KEY = 'settings';
const HISTORY_KEY = 'history';
/**
 * Raised from 20: runs are the record of where you have applied, and silently
 * dropping the oldest was losing that. Starred runs sit outside this entirely.
 */
const HISTORY_LIMIT = 100;

interface SyncedSettings {
  activeProviderId: ProviderId | null;
  autoApply?: boolean;
  autoCompile?: boolean;
  models: Partial<Record<ProviderId, string>>;
  claudeCodeEnabled?: boolean;
  defaults?: GenerationDefaults;
  ui?: UiPrefs;
}

interface Secrets {
  apiKeys: Partial<Record<ProviderId, string>>;
}

/** Providers that authenticate with a key; Claude Code has none. */
const KEYED_PROVIDERS = ['openrouter', 'openai', 'anthropic', 'huggingface'] as const;

/** storage.sync can be unavailable or over quota; local is always there. */
async function readSynced(): Promise<SyncedSettings | undefined> {
  try {
    const raw = await browser.storage.sync.get(SYNCED_KEY);
    return raw[SYNCED_KEY] as SyncedSettings | undefined;
  } catch {
    return undefined;
  }
}

async function writeSynced(value: SyncedSettings): Promise<void> {
  try {
    await browser.storage.sync.set({ [SYNCED_KEY]: value });
  } catch {
    // Quota or sync disabled: the local half still holds, and the next read
    // falls back to whatever is there. Not worth failing a settings save over.
  }
}

export async function getSettings(): Promise<Settings> {
  const [syncedRaw, localRaw] = await Promise.all([
    readSynced(),
    browser.storage.local.get([SECRETS_KEY, LEGACY_KEY]),
  ]);

  const secrets = localRaw[SECRETS_KEY] as Secrets | undefined;
  const legacy = localRaw[LEGACY_KEY] as Settings | undefined;

  // First read after the split: rebuild both halves from the old blob so nobody
  // has to paste their keys again. The legacy blob is left alone as a fallback.
  if (!syncedRaw && !secrets && legacy) {
    const migrated = splitSettings(legacy);
    await Promise.all([
      writeSynced(migrated.synced),
      browser.storage.local.set({ [SECRETS_KEY]: migrated.secrets }),
    ]);
    return legacy;
  }

  return composeSettings(syncedRaw, secrets);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next: Settings = {
    ...current,
    ...patch,
    providers: { ...current.providers, ...patch.providers },
  };

  const { synced, secrets } = splitSettings(next);
  await Promise.all([
    writeSynced(synced),
    browser.storage.local.set({ [SECRETS_KEY]: secrets }),
  ]);

  return next;
}

function splitSettings(settings: Settings): { synced: SyncedSettings; secrets: Secrets } {
  const models: SyncedSettings['models'] = {};
  const apiKeys: Secrets['apiKeys'] = {};

  for (const id of KEYED_PROVIDERS) {
    const config = settings.providers[id];
    if (config?.model) models[id] = config.model;
    if (config?.apiKey) apiKeys[id] = config.apiKey;
  }

  return {
    synced: {
      activeProviderId: settings.activeProviderId,
      autoApply: settings.autoApply,
      autoCompile: settings.autoCompile,
      models,
      claudeCodeEnabled: settings.providers.claudeCode?.enabled,
      defaults: settings.defaults,
      ui: settings.ui,
    },
    secrets: { apiKeys },
  };
}

function composeSettings(
  synced: SyncedSettings | undefined,
  secrets: Secrets | undefined,
): Settings {
  const providers: Settings['providers'] = {};

  for (const id of KEYED_PROVIDERS) {
    const apiKey = secrets?.apiKeys?.[id];
    const model = synced?.models?.[id];
    if (apiKey || model) providers[id] = { apiKey: apiKey ?? '', model: model ?? '' };
  }

  if (synced?.claudeCodeEnabled) providers.claudeCode = { enabled: true };

  return {
    activeProviderId: synced?.activeProviderId ?? null,
    autoApply: synced?.autoApply,
    autoCompile: synced?.autoCompile,
    defaults: synced?.defaults,
    ui: synced?.ui,
    providers,
  };
}

/** Notifies the panel when settings change, including from another device. */
export function onSettingsChange(cb: () => void): () => void {
  const listener = (_changes: unknown, area: string) => {
    if (area === 'sync' || area === 'local') cb();
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/* ------------------------------------------------------------------ history */

export async function getHistory(): Promise<HistoryEntry[]> {
  const raw = await browser.storage.local.get(HISTORY_KEY);
  return (raw[HISTORY_KEY] as HistoryEntry[] | undefined) ?? [];
}

/**
 * Newest first, capped — except that a starred run is never evicted. Starring
 * is the user saying "keep this one", and a cap that ignores that would make
 * the star meaningless.
 */
export async function addHistoryEntry(entry: HistoryEntry): Promise<void> {
  const history = await getHistory();
  await browser.storage.local.set({ [HISTORY_KEY]: evict([entry, ...history]) });
}

function evict(history: HistoryEntry[]): HistoryEntry[] {
  if (history.length <= HISTORY_LIMIT) return history;

  const kept: HistoryEntry[] = [];
  let unstarred = 0;

  for (const entry of history) {
    if (entry.starred) {
      kept.push(entry);
      continue;
    }
    if (unstarred < HISTORY_LIMIT) {
      kept.push(entry);
      unstarred++;
    }
  }

  return kept;
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const history = await getHistory();
  await browser.storage.local.set({ [HISTORY_KEY]: history.filter((e) => e.id !== id) });
}

/** Roughly how much room history is taking, for the line in the history panel. */
export async function historyBytes(): Promise<number> {
  const raw = await browser.storage.local.get(HISTORY_KEY);
  return JSON.stringify(raw[HISTORY_KEY] ?? []).length;
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
