import { useState } from 'react';
import { Button, SectionHeader, SwapText } from './ui';

/**
 * Four cards on first open. It exists mainly so the profile is not missed —
 * it sits in the header rather than in the wizard, which is the right place for
 * something written once, but also the easiest place to walk past forever.
 *
 * Skippable, replayable, and it never appears again once dismissed.
 */
const STEPS: { title: string; body: string; action?: 'profile' | 'settings' }[] = [
  {
    title: 'Skillo rewrites your resume for one job',
    body: 'Give it a job link and point it at your Overleaf project. It reads both, rewrites the LaTeX for that posting, and shows you exactly what changed before anything is applied.',
  },
  {
    title: 'It will not invent anything',
    body: 'Every claim has to come from your existing resume or from what you tell it. Where the job asks for something you do not have, it says so instead of writing around it — that gap is the useful part.',
  },
  {
    title: 'Tell it who you are, once',
    body: 'What you want next, the numbers your CV undersells, how you want to be written about. Two minutes, reused by every run, and it makes more difference than any setting here. It stays on this machine.',
    action: 'profile',
  },
  {
    title: 'Bring your own model',
    body: 'OpenRouter, OpenAI, Anthropic, Hugging Face, or Claude Code on your own machine. Your key is stored locally and never synced. Nothing works until one is set up.',
    action: 'settings',
  },
];

export function Tour({
  onDone,
  onOpen,
}: {
  onDone: () => void;
  onOpen: (panel: 'profile' | 'settings') => void;
}) {
  const [index, setIndex] = useState(0);
  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;

  return (
    // Shell already pads; this only needs to fill the height it is given.
    <div className="flex h-full min-h-[420px] flex-col justify-between">
      <div key={index} className="step-enter space-y-3">
        <p className="font-mono text-[10px] text-muted">
          {index + 1} of {STEPS.length}
        </p>
        <SectionHeader>{step.title}</SectionHeader>
        <p className="text-xs leading-relaxed text-ink">{step.body}</p>

        {step.action && (
          <Button
            variant="secondary"
            onClick={() => {
              onDone();
              onOpen(step.action!);
            }}
          >
            {step.action === 'profile' ? 'Fill it in now' : 'Set up a model'}
          </Button>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex gap-1" aria-hidden>
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i <= index ? 'bg-proof' : 'bg-rule'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button
            className="font-mono text-[10px] text-muted underline hover:text-proof"
            onClick={onDone}
          >
            skip
          </button>
          <Button onClick={() => (last ? onDone() : setIndex(index + 1))}>
            <SwapText>{last ? 'Start →' : 'Next →'}</SwapText>
          </Button>
        </div>
      </div>
    </div>
  );
}
