import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  addHistoryEntry,
  clearHistory,
  getHistory,
  getSettings,
  saveSettings,
  updateHistoryEntry,
  type HistoryEntry,
} from '@/lib/storage';
import { INITIAL_STATE, getState, patchState, resetState } from '@/lib/state';

const entry = (id: string): HistoryEntry => ({
  id,
  timestamp: `2026-08-01T00:00:${id.padStart(2, '0')}.000Z`,
  job: {
    jobId: id,
    url: `https://www.linkedin.com/jobs/view/${id}`,
    title: 'Backend Engineer',
    company: 'CtrlChain',
    location: 'Eindhoven',
    descriptionText: 'x'.repeat(500),
    source: 'guest-api',
    extractedAt: '2026-08-01T00:00:00.000Z',
  },
  jobProfile: {
    title: 'Backend Engineer',
    company: 'CtrlChain',
    location: 'Eindhoven',
    seniority: '',
    mustHaveSkills: [],
    niceToHaveSkills: [],
    responsibilities: [],
    toolsAndTech: [],
    atsKeywords: [],
    softSkills: [],
    summaryForTailoring: 'summary',
  },
  originalLatex: 'old',
  revisedLatex: 'new',
  changeSummary: '- changed things',
  applied: false,
  providerId: 'openrouter',
  model: 'some-model',
});

beforeEach(() => {
  fakeBrowser.reset();
});

describe('settings storage', () => {
  it('returns defaults before anything is saved', async () => {
    const settings = await getSettings();
    expect(settings.activeProviderId).toBeNull();
    expect(settings.providers).toEqual({});
  });

  it('merges provider config instead of replacing the whole map', async () => {
    await saveSettings({ providers: { openrouter: { apiKey: 'a', model: 'm1' } } });
    await saveSettings({ providers: { anthropic: { apiKey: 'b', model: 'm2' } } });

    const settings = await getSettings();
    expect(settings.providers.openrouter).toEqual({ apiKey: 'a', model: 'm1' });
    expect(settings.providers.anthropic).toEqual({ apiKey: 'b', model: 'm2' });
  });

  it('persists the active provider', async () => {
    await saveSettings({ activeProviderId: 'openai' });
    expect((await getSettings()).activeProviderId).toBe('openai');
  });
});

describe('settings storage split', () => {
  const rawSync = async () => (await fakeBrowser.storage.sync.get(null)) as Record<string, unknown>;
  const rawLocal = async () =>
    (await fakeBrowser.storage.local.get(null)) as Record<string, unknown>;

  it('never lets an API key reach sync storage', async () => {
    await saveSettings({
      activeProviderId: 'openrouter',
      providers: { openrouter: { apiKey: 'sk-secret-value', model: 'some/model' } },
    });

    // The whole sync area, serialized, must not contain the key anywhere.
    expect(JSON.stringify(await rawSync())).not.toContain('sk-secret-value');
    expect(JSON.stringify(await rawLocal())).toContain('sk-secret-value');
  });

  it('puts the choices worth carrying between machines into sync', async () => {
    await saveSettings({
      activeProviderId: 'anthropic',
      providers: { anthropic: { apiKey: 'sk-ant', model: 'claude-model' } },
      defaults: { fitLevel: 4, pageLimit: 1, fillLastPage: true },
      ui: { matchExpanded: true },
    });

    const synced = JSON.stringify(await rawSync());
    expect(synced).toContain('anthropic');
    expect(synced).toContain('claude-model');
    expect(synced).toContain('fillLastPage');
    expect(synced).toContain('matchExpanded');
  });

  it('reassembles both halves on read', async () => {
    await saveSettings({
      activeProviderId: 'openai',
      providers: { openai: { apiKey: 'sk-openai', model: 'gpt-model' } },
      defaults: { pageLimit: 3 },
    });

    const settings = await getSettings();
    expect(settings.activeProviderId).toBe('openai');
    expect(settings.providers.openai).toEqual({ apiKey: 'sk-openai', model: 'gpt-model' });
    expect(settings.defaults?.pageLimit).toBe(3);
  });

  it('carries the Claude Code toggle through sync', async () => {
    await saveSettings({
      activeProviderId: 'claude-code',
      providers: { claudeCode: { enabled: true } },
    });
    expect((await getSettings()).providers.claudeCode).toEqual({ enabled: true });
  });

  it('migrates a pre-split settings blob without making the user re-paste keys', async () => {
    // What an older install left behind: everything in one local blob.
    await fakeBrowser.storage.local.set({
      settings: {
        activeProviderId: 'openrouter',
        providers: { openrouter: { apiKey: 'sk-legacy', model: 'legacy/model' } },
        defaults: { fitLevel: 5 },
      },
    });

    const migrated = await getSettings();
    expect(migrated.providers.openrouter).toEqual({
      apiKey: 'sk-legacy',
      model: 'legacy/model',
    });
    expect(migrated.defaults?.fitLevel).toBe(5);

    // And the halves have been written to their new homes, keys still local.
    expect(JSON.stringify(await rawSync())).toContain('legacy/model');
    expect(JSON.stringify(await rawSync())).not.toContain('sk-legacy');

    // A second read comes from the new layout and is unchanged.
    expect(await getSettings()).toEqual(migrated);
  });
});

describe('history storage', () => {
  it('keeps newest first', async () => {
    await addHistoryEntry(entry('1'));
    await addHistoryEntry(entry('2'));
    expect((await getHistory()).map((e) => e.id)).toEqual(['2', '1']);
  });

  it('caps at 20 entries, dropping the oldest', async () => {
    for (let i = 1; i <= 25; i++) await addHistoryEntry(entry(String(i)));

    const history = await getHistory();
    expect(history).toHaveLength(20);
    expect(history[0]!.id).toBe('25');
    expect(history.at(-1)!.id).toBe('6');
  });

  it('flips the applied flag on one entry only', async () => {
    await addHistoryEntry(entry('1'));
    await addHistoryEntry(entry('2'));
    await updateHistoryEntry('1', { applied: true });

    const history = await getHistory();
    expect(history.find((e) => e.id === '1')!.applied).toBe(true);
    expect(history.find((e) => e.id === '2')!.applied).toBe(false);
  });

  it('ignores an update for an id that is gone', async () => {
    await addHistoryEntry(entry('1'));
    await updateHistoryEntry('missing', { applied: true });
    expect((await getHistory())[0]!.applied).toBe(false);
  });

  it('clears', async () => {
    await addHistoryEntry(entry('1'));
    await clearHistory();
    expect(await getHistory()).toEqual([]);
  });
});

describe('wizard state', () => {
  it('starts on the job step', async () => {
    expect(await getState()).toEqual(INITIAL_STATE);
  });

  it('merges patches without dropping other fields', async () => {
    await patchState({ notes: 'emphasize Python' });
    await patchState({ step: 'resume' });

    const state = await getState();
    expect(state.notes).toBe('emphasize Python');
    expect(state.step).toBe('resume');
  });

  it('resets everything', async () => {
    await patchState({ step: 'review', notes: 'x' });
    expect(await resetState()).toEqual(INITIAL_STATE);
    expect(await getState()).toEqual(INITIAL_STATE);
  });
});
