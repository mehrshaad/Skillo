import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@/lib/errors';
import { scoreMatch } from '@/lib/pipeline/scoreMatch';
import type { JobProfile } from '@/lib/pipeline/types';
import type { LLMProvider } from '@/lib/providers/types';

const profile: JobProfile = {
  title: 'Backend Engineer',
  company: 'CtrlChain',
  location: 'Eindhoven',
  seniority: 'Mid-Senior level',
  mustHaveSkills: ['Python', 'Kubernetes'],
  niceToHaveSkills: [],
  responsibilities: [],
  toolsAndTech: [],
  atsKeywords: ['CI/CD'],
  softSkills: [],
  summaryForTailoring: 'Wants a pragmatic backend engineer.',
};

function providerReturning(...texts: string[]) {
  const complete = vi.fn();
  for (const text of texts) complete.mockResolvedValueOnce({ text });
  // `satisfies` keeps the mock's type available for assertions.
  return { id: 'openai', complete, test: async () => {} } satisfies LLMProvider;
}

const run = (provider: LLMProvider) => scoreMatch(provider, 'm', profile, 'OLD', 'NEW');

describe('scoreMatch', () => {
  it('parses a clean reply', async () => {
    const provider = providerReturning(
      JSON.stringify({
        originalScore: 6,
        revisedScore: 8,
        rationale: 'The revision surfaces Kubernetes work that was buried.',
        remainingGaps: ['No evidence of Go'],
      }),
    );

    const score = await run(provider);
    expect(score).toEqual({
      originalScore: 6,
      revisedScore: 8,
      rationale: 'The revision surfaces Kubernetes work that was buried.',
      remainingGaps: ['No evidence of Go'],
    });
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('sends both versions clearly labelled', async () => {
    const provider = providerReturning('{"originalScore":5,"revisedScore":5}');
    await run(provider);

    const userMessage = provider.complete.mock.calls[0]![0].messages[1].content;
    expect(userMessage).toContain('RESUME A');
    expect(userMessage).toContain('OLD');
    expect(userMessage).toContain('RESUME B');
    expect(userMessage).toContain('NEW');
  });

  it('clamps out-of-range scores instead of trusting them', async () => {
    const score = await run(
      providerReturning('{"originalScore":-3,"revisedScore":47}'),
    );
    expect(score.originalScore).toBe(0);
    expect(score.revisedScore).toBe(10);
  });

  it('accepts numbers written as strings and rounds decimals', async () => {
    const score = await run(
      providerReturning('{"originalScore":"6.4","revisedScore":7.6}'),
    );
    expect(score.originalScore).toBe(6);
    expect(score.revisedScore).toBe(8);
  });

  it('tolerates missing rationale and gaps', async () => {
    const score = await run(providerReturning('{"originalScore":4,"revisedScore":6}'));
    expect(score.rationale).toBe('');
    expect(score.remainingGaps).toEqual([]);
  });

  it('drops non-string gaps', async () => {
    const score = await run(
      providerReturning('{"originalScore":4,"revisedScore":6,"remainingGaps":["No Go",7,null,"No AWS"]}'),
    );
    expect(score.remainingGaps).toEqual(['No Go', 'No AWS']);
  });

  it('unwraps a fenced reply', async () => {
    const score = await run(
      providerReturning('```json\n{"originalScore":3,"revisedScore":5}\n```'),
    );
    expect(score.revisedScore).toBe(5);
  });

  it('retries once when the reply is not JSON', async () => {
    const provider = providerReturning(
      'Sure, here is my assessment...',
      '{"originalScore":5,"revisedScore":7}',
    );
    expect((await run(provider)).revisedScore).toBe(7);
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry also fails', async () => {
    const provider = providerReturning('nope', 'still nope');
    await expect(run(provider)).rejects.toMatchObject({ code: ErrorCode.LLM_BAD_FORMAT });
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('rejects a reply with no usable scores', async () => {
    const provider = providerReturning('{"rationale":"looks good"}', '{"rationale":"still good"}');
    await expect(run(provider)).rejects.toMatchObject({ code: ErrorCode.LLM_BAD_FORMAT });
  });
});
