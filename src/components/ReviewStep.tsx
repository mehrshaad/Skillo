import { useState } from 'react';
import type { AppError } from '@/lib/errors';
import { sendMessage } from '@/lib/messages';
import type { WizardState } from '@/lib/state';
import { DiffView } from './DiffView';
import { Button, ErrorNote, Eyebrow, Note, Spinner, TextArea } from './ui';

export function ReviewStep({ state }: { state: WizardState }) {
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [copied, setCopied] = useState(false);

  const result = state.generation.result;
  const resume = state.resume;
  const regenerating = state.generation.status === 'tailoring';

  if (!result || !resume) {
    return <p className="text-xs text-muted">Nothing has been generated yet.</p>;
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([result.latex], { type: 'text/x-tex' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = resume.filename ?? 'resume-tailored.tex';
    link.click();
    URL.revokeObjectURL(url);
  };

  const regenerate = async () => {
    setError(null);
    const res = await sendMessage({ type: 'pipeline/regenerate', feedback });
    if (res.ok) {
      setFeedback('');
      setShowFeedback(false);
    } else {
      setError(res.error);
    }
  };

  return (
    <div className="space-y-4">
      {result.validationErrors && result.validationErrors.length > 0 && (
        <Note>
          <p className="font-medium">This revision did not pass Skillo's LaTeX checks.</p>
          <ul className="mt-1 space-y-0.5">
            {result.validationErrors.map((problem) => (
              <li key={problem}>· {problem}</li>
            ))}
          </ul>
          <p className="mt-1">
            You can still copy or download it, but check it compiles before relying on it.
          </p>
        </Note>
      )}

      <section className="space-y-1.5">
        <Eyebrow>What changed</Eyebrow>
        <div className="whitespace-pre-wrap rounded-sm bg-paper-sunk px-2.5 py-2 text-xs leading-relaxed">
          {result.changeSummary}
        </div>
      </section>

      <DiffView oldText={resume.latex} newText={result.latex} />

      <section className="flex flex-wrap gap-2 border-t border-rule pt-3">
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(result.latex);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copied' : 'Copy LaTeX'}
        </Button>
        <Button variant="secondary" onClick={download}>
          Download .tex
        </Button>
        <Button variant="ghost" onClick={() => setShowFeedback((v) => !v)}>
          Regenerate with feedback
        </Button>
      </section>

      {showFeedback && (
        <section className="space-y-2">
          <Eyebrow>What should be different?</Eyebrow>
          <TextArea
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. keep the education section where it was, and stop calling me a 'seasoned' engineer"
            aria-label="Regeneration feedback"
            disabled={regenerating}
          />
          <Button disabled={!feedback.trim() || regenerating} onClick={() => void regenerate()}>
            {regenerating ? <Spinner /> : null}
            Regenerate
          </Button>
        </section>
      )}

      <Note>
        Applying straight into Overleaf lands in the next milestone. For now, copy or download the
        LaTeX and paste it into your project.
      </Note>

      {error && <ErrorNote error={error} />}
    </div>
  );
}
