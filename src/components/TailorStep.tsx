import type { AppError } from '@/core/errors';
import { sendMessage } from '@/lib/messages';
import { FIT_LEVEL_CAPTIONS, FIT_LEVEL_LABELS } from '@/core/pipeline/prompts';
import type { FitLevel, PageLimit, WizardState } from '@/lib/state';
import { Button, ErrorNote, LevelBar, Note, SectionHeader, Spinner, TextArea, Toggle } from './ui';

const PROGRESS_LABEL: Record<string, string> = {
  analyzing: 'Reading the job posting…',
  tailoring: 'Rewriting your resume…',
  critiquing: 'Screening it the way a recruiter would…',
  revising: 'Fixing what the screening found…',
  validating: 'Checking the LaTeX…',
};

/**
 * The notes draft and the generate action are owned by App, because the footer's
 * Continue triggers the same run from outside this component. Two buttons, one
 * action, one copy of the notes — nothing to keep in sync.
 */
export function TailorStep({
  state,
  notes,
  error,
  onNotesChange,
  onGenerate,
}: {
  state: WizardState;
  notes: string;
  error: AppError | null;
  onNotesChange: (notes: string) => void;
  onGenerate: () => void;
}) {
  const running = state.generation.status !== 'idle' &&
    state.generation.status !== 'done' &&
    state.generation.status !== 'error';

  const patch = (p: Partial<WizardState>) =>
    void sendMessage({ type: 'state/update', patch: p });

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <SectionHeader
          meta={
            <span className="font-semibold text-proof">{FIT_LEVEL_LABELS[state.fitLevel]}</span>
          }
        >
          How much to change
        </SectionHeader>
        <LevelBar
          value={state.fitLevel}
          stops={5}
          disabled={running}
          label="How much to change"
          endLabels={['lowest', 'very high']}
          onChange={(v) => patch({ fitLevel: v as FitLevel })}
        />
        <p className="text-xs text-muted">{FIT_LEVEL_CAPTIONS[state.fitLevel]}</p>
      </section>

      <section className="space-y-2">
        <SectionHeader
          meta={
            <span className="font-semibold text-proof">
              {state.pageLimit} {state.pageLimit === 1 ? 'page' : 'pages'}
            </span>
          }
        >
          Page limit
        </SectionHeader>
        <LevelBar
          value={state.pageLimit}
          stops={3}
          disabled={running}
          label="Page limit"
          endLabels={['1 page', '3 pages']}
          onChange={(v) => patch({ pageLimit: v as PageLimit })}
        />
        <Toggle
          checked={state.fillLastPage}
          disabled={running}
          onChange={(v) => patch({ fillLastPage: v })}
          label="Fill the last page"
          description="Asks for a full last page rather than a half-empty one. Skillo can verify the page count after applying, but not how full the last page ended up — check that yourself."
        />
      </section>

      <section className="space-y-2">
        <SectionHeader
          meta={
            <span className="font-semibold text-proof">
              {state.highEffort ? 'three passes' : 'one pass'}
            </span>
          }
        >
          How hard to work
        </SectionHeader>
        <Toggle
          checked={state.highEffort}
          disabled={running}
          onChange={(v) => patch({ highEffort: v })}
          label="Screen it before showing it to you"
          description="Writes the resume, reads it back as a hostile recruiter would, then fixes what that finds — including anything it cannot support from your original. Noticeably better writing, and the pass that catches invented claims. Roughly three times the tokens and the wait."
        />
      </section>

      <section className="space-y-2">
        <SectionHeader meta="optional">Anything to emphasize?</SectionHeader>
        <TextArea
          rows={4}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="e.g. lean on my Python work, I led the migration project, I'm relocating to Amsterdam"
          aria-label="Notes for tailoring"
          disabled={running}
        />
        <p className="text-xs text-muted">
          Notes are treated as facts about you, so the rewrite may use them. Everything else must
          already be in your resume — Skillo is instructed never to invent experience, at any
          setting above.
        </p>
      </section>

      {running ? (
        <div className="flex items-center gap-2 text-xs font-medium text-proof">
          <Spinner />
          {PROGRESS_LABEL[state.generation.status] ?? 'Working…'}
        </div>
      ) : (
        <Button onClick={onGenerate}>Generate tailored resume</Button>
      )}

      {running && (
        <Note tone="proof">
          This can take a minute on larger models. You can close the panel — the work continues and
          the result will be here when you come back.
        </Note>
      )}

      {error && <ErrorNote error={error} />}
      {!error && state.generation.status === 'error' && state.generation.error && (
        <ErrorNote error={state.generation.error} />
      )}
    </div>
  );
}
