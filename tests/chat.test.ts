import { describe, expect, it, vi } from 'vitest';
import {
  CHAT_SYSTEM_PROMPT,
  chatAboutResume,
  parseChatReply,
  type ChatInput,
} from '@/core/pipeline/chat';
import type { PageBudget } from '@/core/pipeline/pageBudget';
import type { JobProfile } from '@/core/pipeline/types';
import type { LLMProvider } from '@/core/providers/types';

const body = (fill: string) =>
  `\\documentclass{article}\\begin{document}${fill.repeat(3000)}\\end{document}`;

const ORIGINAL = body('x');
const CURRENT = body('y');

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
  mustHaveSkills: ['Kubernetes'],
  niceToHaveSkills: [],
  responsibilities: [],
  toolsAndTech: [],
  atsKeywords: [],
  softSkills: [],
  summaryForTailoring: 'They want platform work.',
};

const reply = (text: string) => vi.fn().mockResolvedValue({ text, stopReason: 'stop' });

function inputWith(complete: LLMProvider['complete'], over: Partial<ChatInput> = {}): ChatInput {
  return {
    provider: { id: 'openai', complete, test: async () => {} },
    model: 'test-model',
    job,
    latex: CURRENT,
    originalLatex: ORIGINAL,
    budget,
    turns: [],
    message: 'hello',
    ...over,
  };
}

describe('CHAT_SYSTEM_PROMPT', () => {
  it('describes both jobs, so neither needs a mode switch', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('THEY ASK FOR A CHANGE');
    expect(CHAT_SYSTEM_PROMPT).toContain('THEY ASK A QUESTION');
    expect(CHAT_SYSTEM_PROMPT).toContain('No LaTeX block at all');
  });

  it('extends the no-fabrication rule to coaching, not just to edits', () => {
    // Advising someone to claim something they have not done is worse than a
    // bad resume: it gets caught in the room.
    expect(CHAT_SYSTEM_PROMPT).toContain('applies to interview advice as much as to edits');
    expect(CHAT_SYSTEM_PROMPT).toContain('caught in the room');
  });

  it('asks for honesty about weak spots rather than reassurance', () => {
    expect(CHAT_SYSTEM_PROMPT).toMatch(/Do not soften a real problem/);
  });
});

describe('parseChatReply', () => {
  it('treats a reply with no block as prose', () => {
    const parsed = parseChatReply('They will ask how you handled the migration.');
    expect(parsed.latex).toBeUndefined();
    expect(parsed.text).toBe('They will ask how you handled the migration.');
  });

  it('splits an edit into the explanation and the file', () => {
    const parsed = parseChatReply(`Moved education up.\n===LATEX===\n${CURRENT}\n===END===`);
    expect(parsed.text).toBe('Moved education up.');
    expect(parsed.latex).toBe(CURRENT);
  });

  it('survives a missing closing marker rather than losing the file', () => {
    const parsed = parseChatReply(`Done.\n===LATEX===\n${CURRENT}`);
    expect(parsed.latex).toBe(CURRENT);
  });

  it('does not mistake an empty block for an edit', () => {
    const parsed = parseChatReply('Here you go.\n===LATEX===\n\n===END===');
    expect(parsed.latex).toBeUndefined();
  });
});

describe('chatAboutResume', () => {
  it('answers a question without offering anything to apply', async () => {
    const complete = reply('They will push on Kubernetes, which your resume does not evidence.');
    const result = await chatAboutResume(inputWith(complete, { message: 'What will they ask?' }));

    expect(result.latex).toBeUndefined();
    expect(result.text).toContain('Kubernetes');
  });

  it('returns an edit that passes the LaTeX checks', async () => {
    const complete = reply(`Tightened the summary.\n===LATEX===\n${CURRENT}\n===END===`);
    const result = await chatAboutResume(inputWith(complete));

    expect(result.latex).toBe(CURRENT);
    expect(result.validationErrors).toBeUndefined();
  });

  it('marks an unusable edit rather than offering it', async () => {
    // Unbalanced environment: applying this would break their document.
    const broken = '\\documentclass{article}\\begin{document}\\begin{itemize}\\end{document}';
    const complete = reply(`Here.\n===LATEX===\n${broken}\n===END===`);
    const result = await chatAboutResume(inputWith(complete));

    expect(result.latex).toBe(broken);
    expect(result.validationErrors?.length).toBeGreaterThan(0);
  });

  it('gives the model the gaps and the missing keywords, not just the resume', async () => {
    const complete = reply('ok');
    await chatAboutResume(
      inputWith(complete, {
        match: {
          originalScore: 4,
          revisedScore: 6,
          rationale: 'Better, still light on platform work.',
          remainingGaps: ['no Kubernetes in production'],
        },
        ats: {
          before: { covered: [], missing: [], coverage: 0, score: 0 },
          after: { covered: ['Docker'], missing: ['Terraform'], coverage: 0.5, score: 5 },
        },
      }),
    );

    const context = complete.mock.calls[0]![0].messages[1]!.content;
    expect(context).toContain('no Kubernetes in production');
    expect(context).toContain('Terraform');
    expect(context).toContain('6 out of 10');
  });

  it('replays an earlier edit so a follow-up builds on it', async () => {
    const complete = reply('ok');
    await chatAboutResume(
      inputWith(complete, {
        turns: [
          { role: 'user', content: 'shorten it', at: '2026-01-01T00:00:00.000Z' },
          { role: 'assistant', content: 'Shortened.', latex: CURRENT, at: '2026-01-01T00:00:00.000Z' },
        ],
        message: 'now move education up',
      }),
    );

    const messages = complete.mock.calls[0]![0].messages;
    // system, context, user, assistant(with file), user
    expect(messages).toHaveLength(5);
    expect(messages[3]!.content).toContain(CURRENT);
    expect(messages[4]!.content).toBe('now move education up');
  });
});
