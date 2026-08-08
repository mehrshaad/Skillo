import { useState } from 'react';
import type { AppError } from '@/core/errors';
import { sendMessage } from '@/lib/messages';
import { Button, ErrorNote, SectionHeader, Spinner, SwapText, TextArea } from './ui';

/**
 * Written on demand rather than on every run, so runs that do not want one pay
 * nothing for it. Editable once it arrives — it is a draft, not an artifact,
 * and the last few words should be the user's.
 */
export function CoverLetter({ company }: { company: string }) {
  const [letter, setLetter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const write = async () => {
    setBusy(true);
    setError(null);
    const res = await sendMessage({ type: 'pipeline/coverLetter' });
    if (res.ok) setLetter(res.data.letter);
    else setError(res.error);
    setBusy(false);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([letter ?? ''], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `cover-letter${company ? `-${company.toLowerCase().replace(/\W+/g, '-')}` : ''}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="space-y-2">
      <SectionHeader meta={letter ? `${letter.split(/\s+/).length} words` : 'optional'}>
        Cover letter
      </SectionHeader>

      {letter === null ? (
        <>
          <p className="text-xs text-muted">
            Written from the tailored resume, so the two say the same thing. Costs one more model
            call, and only when you ask.
          </p>
          <Button variant="secondary" disabled={busy} onClick={() => void write()}>
            {busy ? <Spinner /> : null}
            <SwapText>{busy ? 'Writing…' : 'Write a cover letter'}</SwapText>
          </Button>
        </>
      ) : (
        <>
          <TextArea
            rows={12}
            value={letter}
            onChange={(e) => {
              setLetter(e.target.value);
              setCopied(false);
            }}
            aria-label="Cover letter"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(letter);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              <SwapText>{copied ? 'Copied' : 'Copy'}</SwapText>
            </Button>
            <Button variant="secondary" onClick={download}>
              Download .txt
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void write()}>
              {busy ? <Spinner /> : null}
              Write another
            </Button>
          </div>
          <p className="text-xs text-muted">
            Read it before you send it. It can only use what your resume and profile say, but it
            still chose which parts to lead with.
          </p>
        </>
      )}

      {error && <ErrorNote error={error} />}
    </section>
  );
}
