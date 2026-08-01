import { useEffect, useState } from 'react';
import { ErrorCode, appError, type AppError } from '@/lib/errors';
import { hashText } from '@/lib/hash';
import { sendMessage, type OverleafTabInfo } from '@/lib/messages';
import { LARGE_RESUME_CHARS, findIncludedFiles, looksLikeLatex } from '@/lib/resumeInput';
import type { ResumeSource } from '@/lib/state';
import { Button, Chip, ErrorNote, Eyebrow, Note, Spinner, TextArea } from './ui';

type Mode = 'overleaf' | 'paste' | 'upload';

export function ResumeStep({ resume }: { resume?: ResumeSource }) {
  const [mode, setMode] = useState<Mode>('overleaf');
  const [tabs, setTabs] = useState<OverleafTabInfo[] | null>(null);
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [pasted, setPasted] = useState('');

  const loadTabs = async () => {
    setBusy('tabs');
    setError(null);
    const res = await sendMessage({ type: 'overleaf/listTabs' });
    if (res.ok) setTabs(res.data);
    else setError(res.error);
    setBusy(null);
  };

  useEffect(() => {
    if (!resume) void loadTabs();
    // Only on first render; the user reloads explicitly after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readFromTab = async (tabId: number) => {
    setBusy(`tab-${tabId}`);
    setError(null);
    const res = await sendMessage({ type: 'overleaf/read', tabId });
    if (!res.ok) setError(res.error);
    setBusy(null);
  };

  const useLatex = async (latex: string, kind: 'paste' | 'upload', filename?: string) => {
    setError(null);
    await sendMessage({
      type: 'state/update',
      patch: {
        resume: {
          kind,
          latex,
          hash: hashText(latex),
          filename,
          readAt: new Date().toISOString(),
        },
      },
    });
  };

  if (resume) return <ResumeCard resume={resume} />;

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {(['overleaf', 'paste', 'upload'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-sm px-2 py-1 font-mono text-[11px] ${
              mode === m ? 'bg-ink text-paper' : 'text-muted hover:text-proof'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === 'overleaf' && (
        <section className="space-y-2">
          <Eyebrow>Open Overleaf projects</Eyebrow>
          {tabs === null ? (
            <p className="text-xs text-muted">Looking for Overleaf tabs…</p>
          ) : tabs.length === 0 ? (
            <Note>
              No Overleaf project tab is open. Open your resume project, make sure the .tex file is
              showing in the Code Editor, then reload this list.
            </Note>
          ) : (
            <ul className="space-y-1">
              {tabs.map((tab) => (
                <li key={tab.tabId}>
                  <button
                    onClick={() => void readFromTab(tab.tabId)}
                    disabled={busy !== null}
                    className="flex w-full items-center gap-2 rounded-sm border border-rule px-2 py-1.5 text-left hover:border-proof disabled:opacity-50"
                  >
                    {busy === `tab-${tab.tabId}` && <Spinner />}
                    <span className="truncate font-mono text-[11px]">{tab.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button variant="secondary" disabled={busy !== null} onClick={() => void loadTabs()}>
            {busy === 'tabs' ? <Spinner /> : null}
            Reload list
          </Button>
          <p className="text-xs text-muted">
            Skillo reads whichever file is open in the editor. Open your main .tex file first.
          </p>
        </section>
      )}

      {mode === 'paste' && (
        <section className="space-y-2">
          <Eyebrow>Paste your LaTeX resume</Eyebrow>
          <TextArea
            rows={10}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="\documentclass{article}…"
            spellCheck={false}
            aria-label="Resume LaTeX"
          />
          {pasted.trim() && !looksLikeLatex(pasted) && (
            <Note>
              That does not contain \documentclass or \begin&#123;document&#125;. Paste the whole
              .tex file, not a fragment.
            </Note>
          )}
          <Button
            disabled={!looksLikeLatex(pasted)}
            onClick={() => void useLatex(pasted.trim(), 'paste')}
          >
            Use this resume
          </Button>
        </section>
      )}

      {mode === 'upload' && (
        <section className="space-y-2">
          <Eyebrow>Upload a .tex file</Eyebrow>
          <input
            type="file"
            accept=".tex,text/plain"
            className="w-full font-mono text-[11px] text-muted file:mr-2 file:rounded-sm file:border file:border-rule file:bg-paper file:px-2 file:py-1 file:font-mono file:text-[11px]"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              if (!looksLikeLatex(text)) {
                setError(
                  appError(
                    ErrorCode.INVALID_RESUME_FILE,
                    'That file does not look like a LaTeX document.',
                    'It contains no \\documentclass or \\begin{document}. Pick your resume\'s .tex file.',
                  ),
                );
                return;
              }
              await useLatex(text, 'upload', file.name);
            }}
          />
        </section>
      )}

      {error && <ErrorNote error={error} />}
    </div>
  );
}

function ResumeCard({ resume }: { resume: ResumeSource }) {
  const included = findIncludedFiles(resume.latex);
  const lines = resume.latex.split('\n').length;

  return (
    <div className="space-y-3">
      <section className="space-y-1.5">
        <Eyebrow>Resume</Eyebrow>
        <p className="font-mono text-sm">{resume.filename ?? 'untitled.tex'}</p>
        <div className="flex flex-wrap gap-1">
          <Chip>{resume.latex.length.toLocaleString()} chars</Chip>
          <Chip>{lines.toLocaleString()} lines</Chip>
          <Chip tone="proof">
            {resume.kind === 'overleaf'
              ? 'read from Overleaf'
              : resume.kind === 'paste'
                ? 'pasted by you'
                : 'uploaded'}
          </Chip>
        </div>
      </section>

      {included.length > 0 && (
        <Note>
          This file pulls in {included.length} other {included.length === 1 ? 'file' : 'files'} (
          {included.join(', ')}). Skillo tailors only this file — anything in those stays as it is.
        </Note>
      )}

      {resume.latex.length > LARGE_RESUME_CHARS && (
        <Note>
          At {resume.latex.length.toLocaleString()} characters this is a large file. The whole thing
          is sent to your model on every generation, so expect it to be slow and to cost more.
        </Note>
      )}

      <Button
        variant="ghost"
        onClick={() =>
          void sendMessage({ type: 'state/update', patch: { resume: undefined } })
        }
      >
        Use a different resume
      </Button>
    </div>
  );
}
