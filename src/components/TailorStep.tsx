import { useState } from 'react';
import type { AppError } from '@/lib/errors';
import { sendMessage } from '@/lib/messages';
import type { WizardState } from '@/lib/state';
import { Button, ErrorNote, Eyebrow, Note, Spinner, TextArea } from './ui';

const PROGRESS_LABEL: Record<string, string> = {
  analyzing: 'Reading the job posting…',
  tailoring: 'Rewriting your resume…',
  validating: 'Checking the LaTeX…',
};

export function TailorStep({ state }: { state: WizardState }) {
  const [notes, setNotes] = useState(state.notes);
  const [error, setError] = useState<AppError | null>(null);

  const running = state.generation.status === 'analyzing' || state.generation.status === 'tailoring';

  const generate = async () => {
    setError(null);
    const res = await sendMessage({ type: 'pipeline/tailor', notes });
    if (!res.ok) setError(res.error);
  };

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <Eyebrow>Anything to emphasize? (optional)</Eyebrow>
        <TextArea
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. lean on my Python work, I led the migration project, I'm relocating to Amsterdam"
          aria-label="Notes for tailoring"
          disabled={running}
        />
        <p className="text-xs text-muted">
          Notes are treated as facts about you, so the rewrite may use them. Everything else must
          already be in your resume — Skillo is instructed never to invent experience.
        </p>
      </section>

      {running ? (
        <div className="flex items-center gap-2 text-xs text-proof">
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
