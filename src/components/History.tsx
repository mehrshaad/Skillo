import { useEffect, useState } from 'react';
import { clearHistory, getHistory, type HistoryEntry } from '@/lib/storage';
import { DiffView } from './DiffView';
import { MatchScoreCard } from './MatchScoreCard';
import { AtsScoreCard } from './AtsScoreCard';
import { Button, Chip, SectionHeader } from './ui';

export function History({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [open, setOpen] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    void getHistory().then(setEntries);
  }, []);

  if (open) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionHeader>{new Date(open.timestamp).toLocaleString()}</SectionHeader>
          <Button variant="ghost" onClick={() => setOpen(null)}>
            ← all runs
          </Button>
        </div>

        <section className="space-y-1">
          <h2 className="font-mono text-sm">{open.job.title || 'Untitled posting'}</h2>
          <p className="text-xs text-muted">
            {[open.job.company, open.job.location].filter(Boolean).join(' · ')}
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            <Chip>{open.model}</Chip>
            {open.applied ? <Chip tone="proof">applied</Chip> : <Chip>not applied</Chip>}
          </div>
        </section>

        {open.match && <MatchScoreCard match={open.match} />}
        {open.ats && <AtsScoreCard before={open.ats.before} after={open.ats.after} />}

        <section className="space-y-1.5">
          <SectionHeader>What changed</SectionHeader>
          <div className="whitespace-pre-wrap rounded-sm bg-paper-sunk px-2.5 py-2 text-xs leading-relaxed">
            {open.changeSummary}
          </div>
        </section>

        <DiffView oldText={open.originalLatex} newText={open.revisedLatex} />

        <Button
          variant="secondary"
          onClick={() => void navigator.clipboard.writeText(open.revisedLatex)}
        >
          Copy LaTeX
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeader>Past runs</SectionHeader>
        <Button variant="ghost" onClick={onClose}>
          done
        </Button>
      </div>

      {entries === null ? (
        <p className="text-xs text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted">
          Nothing here yet. Every resume you generate is kept on this machine so you can come back
          to it.
        </p>
      ) : (
        <>
          <ul className="space-y-1">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  onClick={() => setOpen(entry)}
                  className="w-full rounded-sm border border-rule px-2 py-1.5 text-left hover:border-proof"
                >
                  <span className="block truncate font-mono text-[11px]">
                    {entry.job.title || 'Untitled posting'}
                  </span>
                  <span className="block text-[10px] text-muted">
                    {entry.job.company || 'unknown company'} ·{' '}
                    {new Date(entry.timestamp).toLocaleDateString()}
                    {entry.applied ? ' · applied' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            onClick={async () => {
              await clearHistory();
              setEntries([]);
            }}
          >
            clear history
          </Button>
        </>
      )}
    </div>
  );
}
