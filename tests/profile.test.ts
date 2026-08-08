import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { EMPTY_PROFILE, IMPORT_PROMPTS, isProfileEmpty, profileBlock } from '@/core/profile';
import { buildTailorUserPrompt } from '@/core/pipeline/prompts';
import type { JobProfile } from '@/core/pipeline/types';
import { clearProfile, getProfile, saveProfile } from '@/lib/profileStore';

const job: JobProfile = {
  title: 'Platform Engineer',
  company: 'Example',
  location: 'Amsterdam',
  salary: '',
  employmentType: '',
  workplaceType: '',
  seniority: '',
  mustHaveSkills: [],
  niceToHaveSkills: [],
  responsibilities: [],
  toolsAndTech: [],
  atsKeywords: [],
  softSkills: [],
  summaryForTailoring: 'They want platform work.',
};

beforeEach(() => {
  fakeBrowser.reset();
});

describe('profileBlock', () => {
  it('is empty when there is nothing to say, so it costs no tokens', () => {
    expect(profileBlock(null)).toBe('');
    expect(profileBlock(EMPTY_PROFILE)).toBe('');
    expect(profileBlock({ ...EMPTY_PROFILE, summary: '   ' })).toBe('');
  });

  it('includes only the parts that were filled in', () => {
    const block = profileBlock({ ...EMPTY_PROFILE, summary: 'Backend engineer, four years.' });
    expect(block).toContain('Backend engineer, four years.');
    expect(block).not.toContain('Constraints a resume cannot show');
  });

  it('never licenses inventing a claim', () => {
    // The profile is the most tempting place for a model to start embroidering,
    // because it is prose about the person rather than their actual CV.
    const block = profileBlock({ ...EMPTY_PROFILE, summary: 'Wants platform work.' });
    expect(block).toContain('does NOT license inventing');
    expect(block).toMatch(/not to manufacture a new claim/);
  });
});

describe('buildTailorUserPrompt', () => {
  it('carries the profile when there is one', () => {
    const prompt = buildTailorUserPrompt(job, 'lean on Python', '\\documentclass{article}', {
      ...EMPTY_PROFILE,
      evidence: 'The 20% win was mine end to end.',
    });
    expect(prompt).toContain('ABOUT THE CANDIDATE');
    expect(prompt).toContain('The 20% win was mine end to end.');
    expect(prompt).toContain('lean on Python');
  });

  it('is unchanged when there is no profile', () => {
    const without = buildTailorUserPrompt(job, 'notes', 'latex');
    const withEmpty = buildTailorUserPrompt(job, 'notes', 'latex', EMPTY_PROFILE);
    expect(withEmpty).toBe(without);
    expect(without).not.toContain('ABOUT THE CANDIDATE');
  });
});

describe('import prompts', () => {
  it('tells the assistant not to guess, in every one of them', () => {
    // Without this line these dumps confabulate, and a confabulated CV is the
    // one outcome Skillo exists to prevent.
    expect(IMPORT_PROMPTS.length).toBeGreaterThan(0);
    for (const { prompt } of IMPORT_PROMPTS) {
      expect(prompt).toMatch(/not recorded|not stated/i);
      expect(prompt).toMatch(/do not (infer|add)/i);
    }
  });
});

describe('profile storage', () => {
  it('round-trips and stamps when it was written', async () => {
    await saveProfile({ summary: 'Backend engineer.' });
    const profile = await getProfile();

    expect(profile.summary).toBe('Backend engineer.');
    expect(profile.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('merges rather than replacing, so one field cannot wipe another', async () => {
    await saveProfile({ summary: 'A' });
    await saveProfile({ constraints: 'B' });

    const profile = await getProfile();
    expect(profile.summary).toBe('A');
    expect(profile.constraints).toBe('B');
  });

  it('never reaches sync storage', async () => {
    // It holds visa status, notice period and why you are leaving. That is the
    // most personal thing Skillo stores, and sync goes through Google.
    await saveProfile({ constraints: 'Needs visa sponsorship', summary: 'Leaving because burnout' });

    const synced = JSON.stringify(await fakeBrowser.storage.sync.get(null));
    expect(synced).not.toContain('sponsorship');
    expect(synced).not.toContain('burnout');

    const local = JSON.stringify(await fakeBrowser.storage.local.get(null));
    expect(local).toContain('sponsorship');
  });

  it('reads as empty before anything is written, and after clearing', async () => {
    expect(isProfileEmpty(await getProfile())).toBe(true);
    await saveProfile({ summary: 'something' });
    expect(isProfileEmpty(await getProfile())).toBe(false);
    await clearProfile();
    expect(isProfileEmpty(await getProfile())).toBe(true);
  });
});
