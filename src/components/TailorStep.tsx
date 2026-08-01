import { useState } from 'react';
import type { AppError } from '@/lib/errors';
import { sendMessage } from '@/lib/messages';
import { FIT_LEVEL_CAPTIONS, FIT_LEVEL_LABELS } from '@/lib/pipeline/prompts';
import type { FitLevel, PageLimit, WizardState } from '@/lib/state';
import { Button, ErrorNote, Eyebrow, LevelBar, Note, Spinner, TextArea, Toggle } from './ui';

const PROGRESS_LABEL: Record<string, string> = {
  analyzing: 'Reading the job posting…',
  tailoring: 'Rewriting your resume…',
  validating: 'Checking the LaTeX…',
};

export function TailorStep({ state }: { state: WizardState }) {
  const [notes, setNotes] = useState(state.notes);
  const [error, setError] = useState<AppError | null>(null);

  const running = state.generation.status === 'analyzing' || state.generation.status === 'tailoring';

  const patch = (p: Partial<WizardState>) =>
    void sendMessage({ type: 'state/update', patch: p });

  const generate = async () => {
    setError(null);
    const res = await sendMessage({ type: 'pipeline/tailor', notes });
    if (!res.ok) setError(res.error);
  };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Eyebrow>How much to change</Eyebrow>
          <span className="font-mono text-[11px] font-semibold text-proof">
            {FIT_LEVEL_LABELS[state.fitLevel]}
          </span>
        </div>
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
        <div className="flex items-baseline justify-between">
          <Eyebrow>Page limit</Eyebrow>
          <span className="font-mono text-[11px] font-semibold text-proof">
            {state.pageLimit} {state.pageLimit === 1 ? 'page' : 'pages'}
          </span>
        </div>
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
          description="Expand or trim so the last page ends full, rather than half empty."
        />
      </section>

      <section className="space-y-2">
        <Eyebrow>Anything to emphasize? (optional)</Eyebrow>
        <TextArea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
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
        <Button onClick={() => void generate()}>Generate tailored resume</Button>
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
