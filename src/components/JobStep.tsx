import { useState } from 'react';
import type { AppError } from '@/lib/errors';
import { sendMessage } from '@/lib/messages';
import type { JobPosting } from '@/lib/jobIntake/types';
import type { JobProfile } from '@/lib/pipeline/types';
import { JobProfileCard } from './JobProfileCard';
import { Button, Chip, ErrorNote, Eyebrow, Note, Spinner, TextArea, TextInput } from './ui';

const SOURCE_LABELS: Record<JobPosting['source'], string> = {
  'guest-api': 'fetched from LinkedIn',
  'active-tab': 'read from your open tab',
  'background-tab': 'read in a background tab',
  manual: 'pasted by you',
};

export function JobStep({
  job,
  profile,
  analyzing,
}: {
  job?: JobPosting;
  profile?: JobProfile;
  analyzing: boolean;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState('');

  const run = async (label: string, action: () => Promise<{ ok: boolean; error?: AppError }>) => {
    setBusy(label);
    setError(null);
    const res = await action();
    if (!res.ok && res.error) {
      setError(res.error);
      // Extraction failures are exactly when the manual escape hatch matters.
      setManualOpen(true);
    }
    setBusy(null);
  };

  if (job) {
    return (
      <div className="space-y-4">
        <JobCard job={job} />

        <section className="space-y-2 border-t border-rule pt-3">
          {profile ? (
            <JobProfileCard profile={profile} />
          ) : (
            <>
              <Eyebrow>Analysis</Eyebrow>
              <p className="text-xs text-muted">
                Skillo reads the posting and pulls out what to emphasize. You can prune the result
                before it shapes the rewrite.
              </p>
              <Button
                disabled={analyzing || busy !== null}
                onClick={() =>
                  void run('analyze', () => sendMessage({ type: 'pipeline/analyze' }))
                }
              >
                {analyzing || busy === 'analyze' ? <Spinner /> : null}
                Analyze this job
              </Button>
            </>
          )}
          {error && <ErrorNote error={error} />}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <Eyebrow>LinkedIn job link</Eyebrow>
        <TextInput
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && url.trim() && !busy) {
              void run('fetch', () => sendMessage({ type: 'job/fetch', url }));
            }
          }}
          placeholder="linkedin.com/jobs/view/…"
          spellCheck={false}
          aria-label="LinkedIn job link"
        />
        <div className="flex gap-2">
          <Button
            disabled={!url.trim() || busy !== null}
            onClick={() => void run('fetch', () => sendMessage({ type: 'job/fetch', url }))}
          >
            {busy === 'fetch' ? <Spinner /> : null}
            Get job details
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void run('tab', () => sendMessage({ type: 'job/useActiveTab' }))}
          >
            {busy === 'tab' ? <Spinner /> : null}
            Use current tab
          </Button>
        </div>
        <p className="text-xs text-muted">
          Skillo reads the posting itself. If LinkedIn will not hand it over, paste the text below.
        </p>
      </section>

      {error && <ErrorNote error={error} />}

      <section className="border-t border-rule pt-3">
        <button
          className="flex w-full items-center justify-between text-left"
          onClick={() => setManualOpen((v) => !v)}
          aria-expanded={manualOpen}
        >
          <Eyebrow>Paste the description instead</Eyebrow>
          <span className="font-mono text-xs text-muted">{manualOpen ? '−' : '+'}</span>
        </button>

        {manualOpen && (
          <div className="mt-2 space-y-2">
            <TextArea
              rows={8}
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="Paste the full job description here."
              aria-label="Job description"
            />
            <Button
              disabled={manualText.trim().length < 300 || busy !== null}
              onClick={() =>
                void run('manual', () =>
                  sendMessage({ type: 'job/manual', url, text: manualText }),
                )
              }
            >
              {busy === 'manual' ? <Spinner /> : null}
              Use this description
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function JobCard({ job }: { job: JobPosting }) {
  const shortDescription = job.descriptionText.slice(0, 260).trim();

  return (
    <div className="space-y-3">
      <section className="space-y-1.5">
        <Eyebrow>Job</Eyebrow>
        <h2 className="font-mono text-sm leading-snug text-ink">
          {job.title || 'Untitled posting'}
        </h2>
        <p className="text-xs text-muted">
          {[job.company, job.location].filter(Boolean).join(' · ') || 'Company not detected'}
        </p>
        <div className="flex flex-wrap gap-1 pt-1">
          {job.seniority && <Chip>{job.seniority}</Chip>}
          {job.employmentType && <Chip>{job.employmentType}</Chip>}
          {job.workplaceType && <Chip>{job.workplaceType}</Chip>}
          <Chip tone="proof">{SOURCE_LABELS[job.source]}</Chip>
        </div>
      </section>

      {job.lowConfidence && (
        <Note>
          Skillo could not find LinkedIn's description markup and fell back to the page text.
          Check that the excerpt below is the job description, not page furniture.
        </Note>
      )}

      {job.descriptionText.length < 600 && (
        <Note>
          Only {job.descriptionText.length} characters came through. If the posting is longer than
          that, paste the full text instead.
        </Note>
      )}

      <section className="space-y-1.5">
        <Eyebrow>Description · {job.descriptionText.length.toLocaleString()} chars</Eyebrow>
        <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-sm bg-paper-sunk px-2.5 py-2 text-xs text-muted">
          {shortDescription}
          {job.descriptionText.length > 260 ? '…' : ''}
        </p>
      </section>

      <Button
        variant="ghost"
        onClick={() => void sendMessage({ type: 'state/update', patch: { job: undefined, step: 'job' } })}
      >
        Use a different job
      </Button>
    </div>
  );
}
