import { describe, expect, it, vi } from 'vitest';
import {
  CRITIQUE_SYSTEM_PROMPT,
  buildRevisionPrompt,
  type Critique,
} from '@/core/pipeline/prompts';
import { critiqueRevision, reviseFromCritique, type TailorInput } from '@/core/pipeline/tailorResume';
import type { LLMProvider } from '@/core/providers/types';
import type { JobProfile, TailorResult } from '@/core/pipeline/types';
import type { PageBudget } from '@/core/pipeline/pageBudget';

const ORIGINAL = `\\documentclass{article}\\begin{document}${'x'.repeat(3000)}\\end{document}`;
const REVISED = `\\documentclass{article}\\begin{document}${'y'.repeat(3000)}\\end{document}`;

const budget: PageBudget = {
  pageLimit: 2,
  fillLastPage: false,
  charsPerPage: 3600,
  targetChars: 7200,
  ceilingChars: null,
  calibrated: false,
  samples: 0,
  measured: false,
};

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

const draft: TailorResult = { latex: REVISED, changeSummary: '- reordered' };

function inputWith(complete: LLMProvider['complete']): TailorInput {
  return {
    provider: { id: 'openai', complete, test: async () => {} },
    model: 'test-model',
    profile: job,
    notes: '',
    latex: ORIGINAL,
    fitLevel: 3,
    budget,
  };
}

const reply = (text: string) => vi.fn().mockResolvedValue({ text, stopReason: 'stop' });

describe('CRITIQUE_SYSTEM_PROMPT', () => {
  it('puts unsupported claims first, above everything else', () => {
    // The critique is the only pass that reads the rewrite against the original
    // with fresh instructions, so it is where fabrication actually gets caught.
    expect(CRITIQUE_SYSTEM_PROMPT).toContain('not supported by the original');
    expect(CRITIQUE_SYSTEM_PROMPT).toContain('matters more than everything else combined');
    expect(CRITIQUE_SYSTEM_PROMPT).toContain('"unsupported"');
  });

  it('asks a screener, not a well-wisher', () => {
    expect(CRITIQUE_SYSTEM_PROMPT).toContain('not the candidate');
    expect(CRITIQUE_SYSTEM_PROMPT).toMatch(/six seconds/);
  });
});

describe('critiqueRevision', () => {
  it('parses findings out of the reply', async () => {
    const complete = reply(
      JSON.stringify({
        unsupported: ['"led a team of 12"'],
        weak: ['the summary could belong to anyone'],
        missed: ['the Postgres migration'],
        verdict: 'No, on this resume.',
      }),
    );

    const critique = await critiqueRevision(inputWith(complete), draft);

    expect(critique).not.toBeNull();
    expect(critique!.unsupported).toEqual(['"led a team of 12"']);
    expect(critique!.missed).toEqual(['the Postgres migration']);
  });

  it('returns null when the screener found nothing, so no third call is made', async () => {
    const complete = reply(JSON.stringify({ unsupported: [], weak: [], missed: [], verdict: 'Yes.' }));
    expect(await critiqueRevision(inputWith(complete), draft)).toBeNull();
  });

  it('returns null rather than throwing when the pass fails', async () => {
    // Additive, exactly like match scoring: losing the critique costs polish,
    // losing the run costs the resume.
    const nonsense = reply('the model rambled instead of returning JSON');
    expect(await critiqueRevision(inputWith(nonsense), draft)).toBeNull();

    const broken = vi.fn().mockRejectedValue(new Error('rate limited'));
    expect(await critiqueRevision(inputWith(broken), draft)).toBeNull();
  });
});

describe('buildRevisionPrompt', () => {
  const critique: Critique = {
    unsupported: ['"led a team of 12"'],
    weak: ['the summary is generic'],
    missed: ['the Postgres migration'],
    verdict: 'Not yet.',
  };

  it('demands that nothing unsupported survives', () => {
    const prompt = buildRevisionPrompt(critique);
    expect(prompt).toContain('"led a team of 12"');
    expect(prompt).toContain('Nothing here may survive');
  });

  it('leaves out sections the screener had nothing for', () => {
    const prompt = buildRevisionPrompt({ ...critique, missed: [], weak: [] });
    expect(prompt).not.toContain('WEAKNESSES');
    expect(prompt).not.toContain('failed to surface');
  });

  it('asks for the file, not a discussion of the critique', () => {
    expect(buildRevisionPrompt(critique)).toContain('not respond to the critique in prose');
  });
});

describe('reviseFromCritique', () => {
  it('sends the draft back as the assistant turn so it is revised, not rewritten', async () => {
    const complete = reply(`===CHANGES===\n- fixed\n===LATEX===\n${REVISED}\n===END===`);
    await reviseFromCritique(inputWith(complete), draft, {
      unsupported: ['"led a team of 12"'],
      weak: [],
      missed: [],
      verdict: '',
    });

    const messages = complete.mock.calls[0]![0].messages;
    expect(messages.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(messages[2]!.content).toContain(REVISED);
    expect(messages[3]!.content).toContain('"led a team of 12"');
    // The rules still apply on the third pass.
    expect(messages[0]!.content).toContain('NEVER invent employers');
  });
});
