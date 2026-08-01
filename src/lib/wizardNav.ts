import { canApply } from './applyRevision';
import type { WizardState, WizardStep } from './state';

export const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'job', label: 'Job' },
  { id: 'resume', label: 'Resume' },
  { id: 'tailor', label: 'Tailor' },
  { id: 'review', label: 'Review' },
];

/** A step is reachable once the step before it has what it needs. */
export function isReachable(step: WizardStep, state: WizardState): boolean {
  switch (step) {
    case 'job':
      return true;
    case 'resume':
      return Boolean(state.job);
    case 'tailor':
      return Boolean(state.job && state.resume);
    case 'review':
      return Boolean(state.generation.result);
  }
}

/**
 * What the footer's forward button does, and whether it can be pressed.
 *
 * The tailor step is the awkward one: there is nothing to continue *to* until a
 * revision exists, so a plain "is the next step reachable?" test leaves the
 * button greyed out at exactly the moment the user wants it. It generates
 * instead — the same action as the button in the step body.
 */
export type FooterAction = 'apply' | 'applied' | 'generate' | 'next';

export function footerAction(
  state: WizardState,
  busy: { applying: boolean; generating: boolean },
): { action: FooterAction; disabled: boolean } {
  if (state.step === 'review') {
    if (state.appliedAt) return { action: 'applied', disabled: true };
    return { action: 'apply', disabled: !canApply(state) || busy.applying };
  }

  if (state.step === 'tailor' && !state.generation.result) {
    return { action: 'generate', disabled: busy.generating };
  }

  const next = STEPS[STEPS.findIndex((s) => s.id === state.step) + 1];
  return { action: 'next', disabled: !next || !isReachable(next.id, state) };
}
