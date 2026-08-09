import { useEffect, useRef, useState } from 'react';
import type { AppError } from '@/core/errors';
import type { ChatTurn } from '@/core/pipeline/chat';
import { sendMessage } from '@/lib/messages';
import { getHistory, updateHistoryEntry } from '@/lib/storage';
import { Button, ErrorNote, Note, SectionHeader, Spinner, SwapText, TextArea } from './ui';

/** Openers that show what it is for, rather than a blank box that suggests nothing. */
const SUGGESTIONS = [
  'What will they ask me in the interview?',
  'Where am I weakest for this job?',
  'What does this role actually do day to day?',
  'Make the summary less generic',
];

function Turn({
  turn,
  onApply,
  applied,
}: {
  turn: ChatTurn;
  onApply: (latex: string) => void;
  applied: boolean;
}) {
  if (turn.role === 'user') {
    return (
      <li className="ml-6 rounded border border-proof/40 bg-proof-wash px-2.5 py-1.5 text-xs text-ink">
        {turn.content}
      </li>
    );
  }

  return (
    <li className="space-y-1.5">
      <p className="whitespace-pre-wrap rounded border border-rule bg-paper-sunk px-2.5 py-2 text-xs leading-relaxed text-ink">
        {turn.content}
      </p>

      {turn.latex && turn.validationErrors?.length ? (
        <Note>
          This rewrite did not pass Skillo's LaTeX checks, so it cannot be applied:{' '}
          {turn.validationErrors.join('; ')}
        </Note>
      ) : turn.latex ? (
        <Button variant="secondary" disabled={applied} onClick={() => onApply(turn.latex!)}>
          <SwapText>{applied ? 'Using this version' : 'Use this version'}</SwapText>
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Both an editor and a coach, decided by what gets asked. Reachable from review
 * and from a reopened run, because the questions worth asking about a job often
 * arrive days after the resume went out.
 */
export function ResumeChat({
  historyId,
  currentLatex,
}: {
  historyId?: string;
  currentLatex: string;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!historyId) return;
    void getHistory().then((history) => {
      setTurns(history.find((e) => e.id === historyId)?.chat ?? []);
    });
  }, [historyId]);

  useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns.length]);

  const ask = async (message: string) => {
    const text = message.trim();
    if (!text || busy) return;

    setBusy(true);
    setError(null);
    // Optimistic, so the question is on screen while the model thinks.
    setTurns((current) => [...current, { role: 'user', content: text, at: new Date().toISOString() }]);
    setDraft('');

    const res = await sendMessage({ type: 'chat/send', message: text });
    if (res.ok) setTurns(res.data.turns);
    else {
      setError(res.error);
      setTurns((current) => current.slice(0, -1));
      setDraft(text);
    }
    setBusy(false);
  };

  const useVersion = (latex: string) => {
    void sendMessage({
      type: 'state/update',
      patch: {
        generation: {
          status: 'done',
          result: { latex, changeSummary: '- Applied an edit from the chat.' },
        },
      },
    });
  };

  const clear = () => {
    setTurns([]);
    if (historyId) void updateHistoryEntry(historyId, { chat: [] });
  };

  return (
    <section className="space-y-2">
      <SectionHeader meta={turns.length > 0 ? `${turns.length} messages` : undefined}>
        Ask about this job
      </SectionHeader>

      {turns.length === 0 && (
        <>
          <p className="text-xs text-muted">
            It has your resume, the posting, and the score. Ask it to change something, or ask it
            what you are walking into.
          </p>
          <div className="flex flex-wrap gap-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => void ask(s)}
                disabled={busy}
                className="rounded-sm border border-rule px-1.5 py-0.5 text-left font-mono text-[10px] text-muted hover:border-proof hover:text-proof disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        </>
      )}

      {turns.length > 0 && (
        <ul className="space-y-2">
          {turns.map((turn, i) => (
            <Turn
              key={`${i}-${turn.at}`}
              turn={turn}
              onApply={useVersion}
              applied={turn.latex === currentLatex}
            />
          ))}
        </ul>
      )}
      <div ref={endRef} />

      {busy && (
        <p className="flex items-center gap-2 text-xs text-proof">
          <Spinner /> Thinking…
        </p>
      )}

      <TextArea
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends; Shift+Enter is a newline, as everywhere else.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void ask(draft);
          }
        }}
        placeholder="Ask anything, or say what to change"
        aria-label="Message"
        disabled={busy}
      />

      <div className="flex items-center gap-2">
        <Button disabled={busy || !draft.trim()} onClick={() => void ask(draft)}>
          Send
        </Button>
        {turns.length > 0 && (
          <button
            className="font-mono text-[10px] text-muted underline hover:text-cut"
            onClick={clear}
          >
            clear
          </button>
        )}
      </div>

      {error && <ErrorNote error={error} />}
    </section>
  );
}
