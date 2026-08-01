import { ErrorCode, appError } from './errors';
import { fail, sendMessage, type Result } from './messages';
import type { WizardState } from './state';

/**
 * Writing the revision back is reachable from two places — the review screen and
 * the footer's final action — so the decision and the call live here rather than
 * being written twice.
 */
export function canApply(state: WizardState): boolean {
  return Boolean(
    state.generation.result &&
      state.resume?.kind === 'overleaf' &&
      state.resume.tabId !== undefined,
  );
}

export async function applyRevision(
  state: WizardState,
): Promise<Result<{ applied: true }>> {
  const result = state.generation.result;
  const resume = state.resume;

  if (!result || !resume || resume.tabId === undefined) {
    return fail(
      appError(
        ErrorCode.INTERNAL,
        'There is no revision to write, or the resume did not come from an Overleaf tab.',
      ),
    );
  }

  return sendMessage({
    type: 'overleaf/write',
    tabId: resume.tabId,
    content: result.latex,
    // Guards against the Overleaf document changing, not against our own local
    // edits to the working copy.
    expectedCurrentHash: resume.overleafDocHash ?? '',
  });
}
