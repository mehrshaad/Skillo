import { useState } from 'react';
import { ErrorCode, type AppError } from '@/lib/errors';
import { sendMessage } from '@/lib/messages';
import type { WizardState } from '@/lib/state';
import { DiffView } from './DiffView';
import { Button, Chip, ErrorNote, Eyebrow, Note, Spinner, TextArea } from './ui';

const PAGE_POLL_ATTEMPTS = 7;
const PAGE_POLL_INTERVAL_MS = 3_000;

/**
 * The only layer that knows what actually happened: Overleaf compiled the file
 * and its PDF viewer says how many pages came out. Everything before this was
 * an estimate.
 */
function PageCheck({
  tabId,
  pageLimit,
  onRegenerate,
}: {
  tabId: number;
  pageLimit: number;
  onRegenerate: (feedback: string) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [pages, setPages] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const check = async () => {
    setChecking(true);
    setDone(false);

    for (let attempt = 0; attempt < PAGE_POLL_ATTEMPTS; attempt++) {
      const res = await sendMessage({ type: 'overleaf/pageCount', tabId });
      if (res.ok && res.data.pages !== null) {
        setPages(res.data.pages);
        setChecking(false);
        setDone(true);
        return;
      }
      await new Promise((r) => setTimeout(r, PAGE_POLL_INTERVAL_MS));
    }

    setPages(null);
    setChecking(false);
    setDone(true);
  };

  return (
    <section className="space-y-2">
      <Eyebrow>Page count</Eyebrow>

      {!done && (
        <>
          <p className="text-xs text-muted">
            Recompile in Overleaf, then check what actually came out.
          </p>
          <Button variant="secondary" disabled={checking} onClick={() => void check()}>
            {checking ? <Spinner /> : null}
            {checking ? 'Reading the compiled PDF…' : 'Check compiled page count'}
          </Button>
        </>
      )}

      {done && pages === null && (
        <p className="text-xs text-muted">
          Could not read the page count from Overleaf — the PDF pane may be closed or the project
          may not have compiled. Check it yourself.
        </p>
      )}

      {done && pages !== null && pages <= pageLimit && (
        <Chip tone="proof">
          compiled to {pages} {pages === 1 ? 'page' : 'pages'}
        </Chip>
      )}

      {done && pages !== null && pages > pageLimit && (
        <>
          <Note>
            It compiled to {pages} pages, but you asked for {pageLimit}. The character budget is an
            estimate — the compiler is the truth.
          </Note>
          <Button
            onClick={() =>
              onRegenerate(
                `The revision compiled to ${pages} pages but must fit ${pageLimit}. Cut the least job-relevant material until it fits.`,
              )
            }
          >
            Regenerate shorter
          </Button>
        </>
      )}
    </section>
  );
}

export function ReviewStep({ state }: { state: WizardState }) {
  const [feedback, setFeedback] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [copied, setCopied] = useState(false);
  const [applying, setApplying] = useState(false);

  const result = state.generation.result;
  const resume = state.resume;
  const regenerating = state.generation.status === 'tailoring';

  if (!result || !resume) {
    return <p className="text-xs text-muted">Nothing has been generated yet.</p>;
  }

  const overleafTabId = resume.kind === 'overleaf' ? resume.tabId : undefined;

  const apply = async () => {
    if (overleafTabId === undefined) return;
    setApplying(true);
    setError(null);
    const res = await sendMessage({
      type: 'overleaf/write',
      tabId: overleafTabId,
      content: result.latex,
      expectedCurrentHash: resume.hash,
    });
    if (!res.ok) setError(res.error);
    setApplying(false);
  };

  const reReadDocument = async () => {
    if (overleafTabId === undefined) return;
    setApplying(true);
    const res = await sendMessage({ type: 'overleaf/read', tabId: overleafTabId });
    setError(res.ok ? null : res.error);
    setApplying(false);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([result.latex], { type: 'text/x-tex' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = resume.filename ?? 'resume-tailored.tex';
    link.click();
    URL.revokeObjectURL(url);
  };

  const regenerateWith = async (text: string) => {
    setError(null);
    const res = await sendMessage({ type: 'pipeline/regenerate', feedback: text });
    if (res.ok) {
      setFeedback('');
      setShowFeedback(false);
    } else {
      setError(res.error);
    }
  };

  const regenerate = () => regenerateWith(feedback);

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
        {overleafTabId !== undefined && (
          <Button disabled={applying || Boolean(state.appliedAt)} onClick={() => void apply()}>
            {applying ? <Spinner /> : null}
            {state.appliedAt ? 'Applied' : 'Apply to Overleaf'}
          </Button>
        )}
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

      {state.appliedAt && (
        <>
          <Note tone="proof">
            Written into Overleaf. Recompile there to check the PDF — Ctrl+Z in the Overleaf editor
            undoes it in one step.
          </Note>
          {overleafTabId !== undefined && (
            <PageCheck
              tabId={overleafTabId}
              pageLimit={state.pageLimit}
              onRegenerate={(feedback) => regenerateWith(feedback)}
            />
          )}
        </>
      )}

      {overleafTabId === undefined && (
        <Note>
          This resume did not come from an Overleaf tab, so Skillo cannot write it back. Copy or
          download the LaTeX and paste it into your project.
        </Note>
      )}

      {error && <ErrorNote error={error} />}

      {error?.code === ErrorCode.OVERLEAF_DOC_CHANGED && (
        <Button variant="secondary" disabled={applying} onClick={() => void reReadDocument()}>
          {applying ? <Spinner /> : null}
          Re-read the document and re-diff
        </Button>
      )}
    </div>
  );
}
