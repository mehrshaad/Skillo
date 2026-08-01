import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@/lib/errors';
import { buildDiff, diffStats } from '@/lib/diff';
import { computePageBudget } from '@/lib/pipeline/pageBudget';
import { regenerateResume, tailorResume } from '@/lib/pipeline/tailorResume';
import type { JobProfile } from '@/lib/pipeline/types';
import type { LLMProvider } from '@/lib/providers/types';

const ORIGINAL = `\\documentclass{article}
\\begin{document}
\\section{Experience}
\\begin{itemize}
  \\item Built internal tooling in Python
  \\item Ran the on-call rotation
\\end{itemize}
\\end{document}`;

const REVISED = ORIGINAL.replace('Ran the on-call rotation', 'Owned CI/CD and the on-call rotation');

const profile: JobProfile = {
  title: 'Backend Engineer',
  company: 'CtrlChain',
  location: 'Eindhoven',
  seniority: 'Mid-Senior level',
  mustHaveSkills: ['Python'],
  niceToHaveSkills: [],
  responsibilities: [],
  toolsAndTech: [],
  atsKeywords: ['CI/CD'],
  softSkills: [],
  summaryForTailoring: 'Wants a pragmatic backend engineer.',
};

const output = (latex: string, changes = '- Surfaced CI/CD experience.') =>
  `===CHANGES===\n${changes}\n===LATEX===\n${latex}\n===END===`;

function providerReturning(...responses: ({ text: string; stopReason?: string } | string)[]) {
  const complete = vi.fn();
  for (const r of responses) {
    complete.mockResolvedValueOnce(typeof r === 'string' ? { text: r } : r);
  }
  return { id: 'openai', complete, test: async () => {} } satisfies LLMProvider;
}

// Calibrated from the fixture itself, so the page checks measure the retry
// behaviour under test rather than the fixture being small.
const input = (provider: LLMProvider) => ({
  provider,
  model: 'm',
  profile,
  notes: '',
  latex: ORIGINAL,
  fitLevel: 3,
  budget: computePageBudget(ORIGINAL, 1, false, 1),
});

describe('tailorResume', () => {
  it('returns a clean revision on the first attempt', async () => {
    const provider = providerReturning(output(REVISED));
    const result = await tailorResume(input(provider));

    expect(result.latex).toBe(REVISED);
    expect(result.changeSummary).toContain('CI/CD');
    expect(result.validationErrors).toBeUndefined();
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('retries once when the model ignores the output format', async () => {
    const provider = providerReturning('Here is your resume!\n' + REVISED, output(REVISED));
    const result = await tailorResume(input(provider));

    expect(result.latex).toBe(REVISED);
    expect(provider.complete).toHaveBeenCalledTimes(2);

    // The retry must carry the format reminder, not just repeat the request.
    const retryMessages = provider.complete.mock.calls[1]![0].messages;
    expect(retryMessages.at(-1).content).toContain('===LATEX===');
  });

  it('gives up on a second format failure', async () => {
    const provider = providerReturning('nope', 'still nope');
    await expect(tailorResume(input(provider))).rejects.toMatchObject({
      code: ErrorCode.LLM_BAD_FORMAT,
    });
  });

  it('retries with the specific validation problem and accepts the fix', async () => {
    const broken = REVISED.replace('\\end{itemize}', '');
    const provider = providerReturning(output(broken), output(REVISED));

    const result = await tailorResume(input(provider));
    expect(result.latex).toBe(REVISED);
    expect(result.validationErrors).toBeUndefined();

    const retryMessages = provider.complete.mock.calls[1]![0].messages;
    expect(retryMessages.at(-1).content).toContain('itemize');
  });

  it('surfaces the output anyway when validation fails twice', async () => {
    const broken = REVISED.replace('\\end{itemize}', '');
    const provider = providerReturning(output(broken), output(broken));

    const result = await tailorResume(input(provider));
    expect(result.latex).toBe(broken);
    expect(result.validationErrors?.join(' ')).toContain('itemize');
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('retries a truncated response with more room', async () => {
    const provider = providerReturning(
      { text: output(REVISED), stopReason: 'length' },
      { text: output(REVISED), stopReason: 'stop' },
    );

    const result = await tailorResume(input(provider));
    expect(result.latex).toBe(REVISED);

    const firstBudget = provider.complete.mock.calls[0]![0].maxTokens;
    const secondBudget = provider.complete.mock.calls[1]![0].maxTokens;
    expect(secondBudget).toBe(firstBudget * 2);
  });

  it('reports truncation when even the larger budget is not enough', async () => {
    const provider = providerReturning(
      { text: output(REVISED), stopReason: 'length' },
      { text: output(REVISED), stopReason: 'length' },
    );
    await expect(tailorResume(input(provider))).rejects.toMatchObject({
      code: ErrorCode.LLM_TRUNCATED,
    });
  });
});

describe('regenerateResume', () => {
  it('sends the previous output and the feedback', async () => {
    const provider = providerReturning(output(REVISED));
    const previous = { changeSummary: '- first pass', latex: REVISED };

    await regenerateResume(input(provider), '===CHANGES===\n- first pass\n===LATEX===\nx\n===END===', 'Keep education first');

    const messages = provider.complete.mock.calls[0]![0].messages;
    expect(messages.at(-2).role).toBe('assistant');
    expect(messages.at(-1).content).toContain('Keep education first');
    expect(previous.latex).toBe(REVISED);
  });
});

describe('buildDiff', () => {
  it('marks added and removed lines', () => {
    const rows = buildDiff('a\nb\nc', 'a\nB\nc');
    expect(diffStats(rows)).toEqual({ added: 1, removed: 1 });
    expect(rows.find((r) => r.kind === 'add')).toMatchObject({ text: 'B' });
    expect(rows.find((r) => r.kind === 'del')).toMatchObject({ text: 'b' });
  });

  it('reports no changes for identical text', () => {
    expect(diffStats(buildDiff(ORIGINAL, ORIGINAL))).toEqual({ added: 0, removed: 0 });
  });

  it('collapses long unchanged runs into a gap', () => {
    const oldText = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const newText = oldText.replace('line 20', 'line twenty');
    const rows = buildDiff(oldText, newText);

    const gaps = rows.filter((r) => r.kind === 'gap');
    expect(gaps.length).toBeGreaterThan(0);
    // Context is kept tight around the single change.
    expect(rows.filter((r) => r.kind === 'context').length).toBeLessThan(12);
  });

  it('numbers lines from one', () => {
    const rows = buildDiff('a\nb\n', 'a\nb\nc\n');
    const added = rows.filter((r) => r.kind === 'add');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ text: 'c', newNo: 3 });
  });
});
