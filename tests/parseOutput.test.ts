import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@/core/errors';
import {
  extractJsonObject,
  parseTailorOutput,
  toJobProfile,
} from '@/core/pipeline/parseOutput';
import { analyzeJob } from '@/core/pipeline/analyzeJob';
import type { JobPosting } from '@/core/jobIntake/types';
import type { LLMProvider } from '@/core/providers/types';

describe('extractJsonObject', () => {
  it('parses a bare object', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('unwraps markdown fences', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('ignores prose before and after the object', () => {
    expect(extractJsonObject('Sure! Here you go:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it('handles nested objects', () => {
    expect(extractJsonObject('{"a":{"b":{"c":2}}}')).toEqual({ a: { b: { c: 2 } } });
  });

  it('is not fooled by braces inside strings', () => {
    expect(extractJsonObject('{"a":"} not the end {","b":2}')).toEqual({
      a: '} not the end {',
      b: 2,
    });
  });

  it('is not fooled by escaped quotes', () => {
    expect(extractJsonObject('{"a":"say \\"hi\\" }","b":1}')).toEqual({ a: 'say "hi" }', b: 1 });
  });

  it('reports a truncated object distinctly', () => {
    expect(() => extractJsonObject('{"a":1')).toThrowError(
      expect.objectContaining({ code: ErrorCode.LLM_BAD_FORMAT }) as unknown as Error,
    );
  });

  it('reports when there is no object at all', () => {
    expect(() => extractJsonObject('I cannot help with that.')).toThrowError(
      expect.objectContaining({ code: ErrorCode.LLM_BAD_FORMAT }) as unknown as Error,
    );
  });
});

describe('toJobProfile', () => {
  const full = {
    title: ' Backend Engineer ',
    company: 'CtrlChain',
    location: 'Eindhoven',
    seniority: 'Mid-Senior level',
    mustHaveSkills: ['Python', ' Django '],
    niceToHaveSkills: [],
    responsibilities: ['Build APIs'],
    toolsAndTech: ['Docker'],
    atsKeywords: ['CI/CD'],
    softSkills: ['Collaboration'],
    summaryForTailoring: 'They want a pragmatic backend engineer.',
  };

  it('trims strings and array entries', () => {
    const profile = toJobProfile(full);
    expect(profile.title).toBe('Backend Engineer');
    expect(profile.mustHaveSkills).toEqual(['Python', 'Django']);
  });

  it('fills in missing keys rather than failing', () => {
    const profile = toJobProfile({ summaryForTailoring: 'Something useful here.' });
    expect(profile.mustHaveSkills).toEqual([]);
    expect(profile.company).toBe('');
  });

  it('drops non-string array entries', () => {
    const profile = toJobProfile({ ...full, atsKeywords: ['CI/CD', 42, null, 'Kubernetes'] });
    expect(profile.atsKeywords).toEqual(['CI/CD', 'Kubernetes']);
  });

  it('rejects a profile with no usable signal', () => {
    expect(() => toJobProfile({ title: 'Engineer' })).toThrowError(
      expect.objectContaining({ code: ErrorCode.LLM_BAD_FORMAT }) as unknown as Error,
    );
  });

  it('rejects a non-object', () => {
    expect(() => toJobProfile(['nope'])).toThrowError(
      expect.objectContaining({ code: ErrorCode.LLM_BAD_FORMAT }) as unknown as Error,
    );
  });
});

describe('parseTailorOutput', () => {
  const good = `===CHANGES===
- Reordered the skills line to lead with Python.
- Cut the unrelated retail bullet.
===LATEX===
\\documentclass{article}
\\begin{document}
Hello
\\end{document}
===END===`;

  it('splits the change summary from the LaTeX', () => {
    const out = parseTailorOutput(good);
    expect(out.changeSummary).toContain('Reordered the skills line');
    expect(out.latex.startsWith('\\documentclass')).toBe(true);
    expect(out.latex.endsWith('\\end{document}')).toBe(true);
  });

  it('tolerates whitespace inside the delimiters', () => {
    const out = parseTailorOutput(good.replace('===CHANGES===', '===  CHANGES  ==='));
    expect(out.latex).toContain('\\documentclass');
  });

  it('tolerates a missing END delimiter', () => {
    const out = parseTailorOutput(good.replace('===END===', ''));
    expect(out.latex.endsWith('\\end{document}')).toBe(true);
  });

  it('strips a code fence around the LaTeX', () => {
    const fenced = `===CHANGES===
- one
===LATEX===
\`\`\`latex
\\documentclass{article}
\\begin{document}x\\end{document}
\`\`\`
===END===`;
    expect(parseTailorOutput(fenced).latex.startsWith('\\documentclass')).toBe(true);
  });

  it('rejects output that ignored the format', () => {
    expect(() => parseTailorOutput('Here is your resume:\n\\documentclass{article}')).toThrowError(
      expect.objectContaining({ code: ErrorCode.LLM_BAD_FORMAT }) as unknown as Error,
    );
  });

  it('rejects an empty LaTeX section', () => {
    expect(() => parseTailorOutput('===CHANGES===\n- none\n===LATEX===\n\n===END===')).toThrowError(
      expect.objectContaining({ code: ErrorCode.LLM_BAD_FORMAT }) as unknown as Error,
    );
  });
});

describe('analyzeJob', () => {
  const job = {
    jobId: '1',
    url: 'https://www.linkedin.com/jobs/view/1',
    title: 'Backend Engineer',
    company: 'CtrlChain',
    location: 'Eindhoven',
    descriptionText: 'We need a backend engineer with Python experience.',
    source: 'guest-api',
    extractedAt: '2026-08-01T00:00:00.000Z',
  } satisfies JobPosting;

  const valid = JSON.stringify({
    title: 'Backend Engineer',
    summaryForTailoring: 'They want a pragmatic backend engineer.',
    mustHaveSkills: ['Python'],
  });

  const providerReturning = (...texts: string[]): LLMProvider => {
    const complete = vi.fn();
    for (const text of texts) complete.mockResolvedValueOnce({ text });
    return { id: 'openai', complete, test: async () => {} };
  };

  it('returns the profile on a clean first reply', async () => {
    const provider = providerReturning(valid);
    const profile = await analyzeJob(provider, 'm', job);
    expect(profile.mustHaveSkills).toEqual(['Python']);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });

  it('retries once when the first reply is not JSON', async () => {
    const provider = providerReturning('I cannot do that.', valid);
    const profile = await analyzeJob(provider, 'm', job);
    expect(profile.title).toBe('Backend Engineer');
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry also fails', async () => {
    const provider = providerReturning('nope', 'still nope');
    await expect(analyzeJob(provider, 'm', job)).rejects.toMatchObject({
      code: ErrorCode.LLM_BAD_FORMAT,
    });
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('reports truncation instead of retrying a cut-off reply', async () => {
    const provider: LLMProvider = {
      id: 'openai',
      complete: vi.fn().mockResolvedValue({ text: '{"title":"Back', stopReason: 'length' }),
      test: async () => {},
    };
    await expect(analyzeJob(provider, 'm', job)).rejects.toMatchObject({
      code: ErrorCode.LLM_TRUNCATED,
    });
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
});
