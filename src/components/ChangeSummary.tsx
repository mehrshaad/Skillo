import { parseBullets } from '@/lib/changeSummary';
import { useUiPref } from './useUiPref';
import { Collapsible } from './ui';

/**
 * The model returns its change list as markdown bullets. Rendered as one block
 * of text they run together and nobody reads them; as separate cards each edit
 * is a thing you can check off against the diff, which is the whole point of
 * having it.
 *
 * Open by default — unlike the scores, this is the part you came to read.
 */
export function ChangeSummary({ summary }: { summary: string }) {
  const [open, setOpen] = useUiPref('changesExpanded', true);
  const items = parseBullets(summary);

  return (
    <Collapsible
      title="What changed"
      open={open}
      onToggle={setOpen}
      headline={
        items.length > 0 ? (
          <span className="font-mono text-[10px] text-muted">
            {items.length} {items.length === 1 ? 'edit' : 'edits'}
          </span>
        ) : undefined
      }
    >
      {items.length === 0 ? (
        <p className="whitespace-pre-wrap rounded border border-rule bg-paper px-2.5 py-2 text-xs leading-relaxed">
          {summary}
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li
              key={`${i}-${item.slice(0, 24)}`}
              className="rounded border border-rule bg-paper px-2.5 py-1.5 text-xs leading-relaxed text-ink"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </Collapsible>
  );
}
