import { describe, expect, it } from 'vitest';
import type { JobPosting } from '@/lib/jobIntake/types';
import type { TailorResult } from '@/lib/pipeline/types';
import type { ResumeSource, WizardState, WizardStep } from '@/lib/state';
import { footerAction, isReachable } from '@/lib/wizardNav';

const RESULT: TailorResult = {
  latex: '\\documentclass{article}',
  changeSummary: '- Did a thing',
};

function stateAt(step: WizardStep, over: Partial<WizardState> = {}): WizardState {
  return {
    step,
    notes: '',
    fitLevel: 3,
    pageLimit: 2,
    fillLastPage: false,
    generation: { status: 'idle' },
    ...over,
  };
}

const JOB: JobPosting = {
  jobId: '1234',
  url: 'https://www.linkedin.com/jobs/view/1234',
  title: 'Platform Engineer',
  company: 'Example',
  location: 'Amsterdam',
  descriptionText: 'Build and run the platform.',
  source: 'guest-api',
  extractedAt: '2026-01-01T00:00:00.000Z',
};

const OVERLEAF: ResumeSource = {
  kind: 'overleaf',
  latex: '\\documentclass{article}',
  tabId: 7,
  readAt: '2026-01-01T00:00:00.000Z',
};

const IDLE = { applying: false, generating: false };

describe('isReachable', () => {
  it('always allows the first step', () => {
    expect(isReachable('job', stateAt('job'))).toBe(true);
  });

  it('gates each step on what the one before it produced', () => {
    const empty = stateAt('job');
    expect(isReachable('resume', empty)).toBe(false);
    expect(isReachable('tailor', empty)).toBe(false);
    expect(isReachable('review', empty)).toBe(false);

    const withJob = stateAt('resume', { job: JOB });
    expect(isReachable('resume', withJob)).toBe(true);
    expect(isReachable('tailor', withJob)).toBe(false);

    const withResume = stateAt('tailor', { job: JOB, resume: OVERLEAF });
    expect(isReachable('tailor', withResume)).toBe(true);
    expect(isReachable('review', withResume)).toBe(false);

    const generated = stateAt('tailor', {
      job: JOB,
      resume: OVERLEAF,
      generation: { status: 'done', result: RESULT },
    });
    expect(isReachable('review', generated)).toBe(true);
  });
});

describe('footerAction', () => {
  it('moves to the next step once it is reachable', () => {
    expect(footerAction(stateAt('job'), IDLE)).toEqual({ action: 'next', disabled: true });
    expect(footerAction(stateAt('job', { job: JOB }), IDLE)).toEqual({
      action: 'next',
      disabled: false,
    });
  });

  it('generates from the tailor step, rather than sitting greyed out', () => {
    // The regression: nothing to continue *to* until a revision exists, so a
    // plain reachability test disabled the button exactly when it was needed.
    const ready = stateAt('tailor', { job: JOB, resume: OVERLEAF });
    expect(footerAction(ready, IDLE)).toEqual({ action: 'generate', disabled: false });
  });

  it('does not let a second run start while one is in flight', () => {
    const running = stateAt('tailor', {
      job: JOB,
      resume: OVERLEAF,
      generation: { status: 'tailoring' },
    });
    expect(footerAction(running, { applying: false, generating: true })).toEqual({
      action: 'generate',
      disabled: true,
    });
  });

  it('goes forward instead of regenerating once a revision exists', () => {
    const generated = stateAt('tailor', {
      job: JOB,
      resume: OVERLEAF,
      generation: { status: 'done', result: RESULT },
    });
    expect(footerAction(generated, IDLE)).toEqual({ action: 'next', disabled: false });
  });

  it('applies on the review step', () => {
    const reviewing = stateAt('review', {
      job: JOB,
      resume: OVERLEAF,
      generation: { status: 'done', result: RESULT },
    });
    expect(footerAction(reviewing, IDLE)).toEqual({ action: 'apply', disabled: false });
  });

  it('cannot apply a resume that did not come from Overleaf', () => {
    const pasted = stateAt('review', {
      job: JOB,
      resume: { kind: 'paste', latex: 'x', readAt: '2026-01-01T00:00:00.000Z' },
      generation: { status: 'done', result: RESULT },
    });
    expect(footerAction(pasted, IDLE)).toEqual({ action: 'apply', disabled: true });
  });

  it('reports applied, and stays disabled, after the write lands', () => {
    const applied = stateAt('review', {
      job: JOB,
      resume: OVERLEAF,
      generation: { status: 'done', result: RESULT },
      appliedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(footerAction(applied, IDLE)).toEqual({ action: 'applied', disabled: true });
  });
});
