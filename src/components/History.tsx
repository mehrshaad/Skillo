import { useEffect, useMemo, useState } from 'react';
import { sendMessage } from '@/lib/messages';
import {
  clearHistory,
  deleteHistoryEntry,
  getHistory,
  historyBytes,
  updateHistoryEntry,
  type HistoryEntry,
} from '@/lib/storage';
import { DiffView } from './DiffView';
import { MatchScoreCard } from './MatchScoreCard';
import { AtsScoreCard } from './AtsScoreCard';
import { Button, Chip, SectionHeader, Spinner, SwapText, TextArea, TextInput } from './ui';

const nameOf = (entry: HistoryEntry) => entry.label || entry.job.title || 'Untitled posting';

/** Everything worth typing into the filter box. */
function haystack(entry: HistoryEntry): string {
  return [entry.label, entry.note, entry.job.title, entry.job.company, entry.job.location, entry.model]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function Detail({
  entry,
  onBack,
  onChange,
}: {
  entry: HistoryEntry;
  onBack: () => void;
  onChange: (patch: Partial<HistoryEntry>) => void;
}) {
  const [reopening, setReopening] = useState(false);

  const reopen = async () => {
    setReopening(true);
    await sendMessage({ type: 'history/reopen', id: entry.id });
    setReopening(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader>{new Date(entry.timestamp).toLocaleString()}</SectionHeader>
        <Button variant="ghost" onClick={onBack}>
          ← all runs
        </Button>
      </div>

      <section className="space-y-2">
        <TextInput
          value={entry.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder={entry.job.title || 'Name this run'}
          aria-label="Name for this run"
        />
        <p className="text-xs text-muted">
          {[entry.job.company, entry.job.location].filter(Boolean).join(' · ')}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <Chip>{entry.model}</Chip>
          {entry.applied ? <Chip tone="proof">applied</Chip> : <Chip>not applied</Chip>}
          {entry.starred && <Chip tone="proof">kept</Chip>}
        </div>
      </section>

      <section className="space-y-1.5">
        <SectionHeader meta="only you see this">Notes</SectionHeader>
        <TextArea
          rows={3}
          value={entry.note ?? ''}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="Who referred you, what you said in the cover letter, when they replied…"
          aria-label="Notes about this run"
        />
      </section>

      <Button disabled={reopening} onClick={() => void reopen()}>
        {reopening ? <Spinner /> : null}
        <SwapText>{reopening ? 'Reopening…' : 'Reopen this run'}</SwapText>
      </Button>
      <p className="text-xs text-muted">
        Puts it back on the review screen, so you can read it, regenerate it, or copy the LaTeX.
        To write it into Overleaf again, pick the project on the resume step first — Skillo will
        not write into a document it has not just read.
      </p>

      {entry.match && <MatchScoreCard match={entry.match} />}
      {entry.ats && <AtsScoreCard before={entry.ats.before} after={entry.ats.after} />}

      <section className="space-y-1.5">
        <SectionHeader>What changed</SectionHeader>
        <div className="whitespace-pre-wrap rounded-sm bg-paper-sunk px-2.5 py-2 text-xs leading-relaxed">
          {entry.changeSummary}
        </div>
      </section>

      <DiffView oldText={entry.originalLatex} newText={entry.revisedLatex} />

      <Button
        variant="secondary"
        onClick={() => void navigator.clipboard.writeText(entry.revisedLatex)}
      >
        Copy LaTeX
      </Button>
    </div>
  );
}

export function History({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [bytes, setBytes] = useState(0);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const refresh = () => {
    void getHistory().then(setEntries);
    void historyBytes().then(setBytes);
  };

  useEffect(refresh, []);

  const patch = (id: string, changes: Partial<HistoryEntry>) => {
    setEntries((current) =>
      current?.map((e) => (e.id === id ? { ...e, ...changes } : e)) ?? current,
    );
    void updateHistoryEntry(id, changes);
  };

  const remove = async (id: string) => {
    setEntries((current) => current?.filter((e) => e.id !== id) ?? current);
    await deleteHistoryEntry(id);
    void historyBytes().then(setBytes);
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return entries ?? [];
    return (entries ?? []).filter((e) => haystack(e).includes(needle));
  }, [entries, query]);

  const open = entries?.find((e) => e.id === openId);
  if (open) {
    return (
      <Detail
        entry={open}
        onBack={() => setOpenId(null)}
        onChange={(changes) => patch(open.id, changes)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeader meta={entries ? String(entries.length) : undefined}>Past runs</SectionHeader>
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
          {entries.length > 5 && (
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by company, title, name or note"
              aria-label="Filter past runs"
            />
          )}

          {filtered.length === 0 ? (
            <p className="text-xs text-muted">Nothing matches “{query}”.</p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-stretch gap-1 rounded-sm border border-rule hover:border-proof"
                >
                  <button
                    onClick={() => patch(entry.id, { starred: !entry.starred })}
                    title={entry.starred ? 'Kept — never dropped' : 'Keep this run'}
                    aria-pressed={entry.starred ?? false}
                    className={`px-1.5 text-sm ${entry.starred ? 'text-proof' : 'text-muted/40 hover:text-proof'}`}
                  >
                    {entry.starred ? '★' : '☆'}
                  </button>

                  <button onClick={() => setOpenId(entry.id)} className="min-w-0 flex-1 py-1.5 text-left">
                    <span className="block truncate font-mono text-[11px]">{nameOf(entry)}</span>
                    <span className="block truncate text-[10px] text-muted">
                      {entry.job.company || 'unknown company'} ·{' '}
                      {new Date(entry.timestamp).toLocaleDateString()}
                      {entry.applied ? ' · applied' : ''}
                      {entry.note ? ' · noted' : ''}
                    </span>
                  </button>

                  <button
                    onClick={() => void remove(entry.id)}
                    title="Delete this run"
                    aria-label={`Delete ${nameOf(entry)}`}
                    className="px-2 font-mono text-[11px] text-muted/50 hover:text-cut"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between border-t border-rule pt-2">
            <span className="font-mono text-[10px] text-muted">
              {Math.max(1, Math.round(bytes / 1024))} KB on this machine
            </span>
            {confirmingClear ? (
              <span className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  className="text-cut"
                  onClick={async () => {
                    await clearHistory();
                    setConfirmingClear(false);
                    refresh();
                  }}
                >
                  delete all {entries.length}?
                </Button>
                <Button variant="ghost" onClick={() => setConfirmingClear(false)}>
                  cancel
                </Button>
              </span>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmingClear(true)}>
                clear history
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
