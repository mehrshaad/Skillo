import { parseBullets } from '@/lib/changeSummary';
import { SectionHeader } from './ui';

/**
 * The model returns its change list as markdown bullets. Rendered as one block
 * of text they run together and nobody reads them; as separate cards each edit
 * is a thing you can check off against the diff, which is the whole point of
 * having it.
 */
export function ChangeSummary({ summary }: { summary: string }) {
  const items = parseBullets(summary);

  return (
    <section className="space-y-1.5">
      <SectionHeader meta={items.length > 0 ? String(items.length) : undefined}>
        What changed
      </SectionHeader>

      {items.length === 0 ? (
        <p className="whitespace-pre-wrap rounded border border-rule bg-paper-sunk px-2.5 py-2 text-xs leading-relaxed">
          {summary}
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li
              key={`${i}-${item.slice(0, 24)}`}
              className="rounded border border-rule bg-paper-sunk px-2.5 py-1.5 text-xs leading-relaxed text-ink"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

