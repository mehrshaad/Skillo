/**
 * Splits the model's change list into individual edits.
 *
 * Returns an empty list when the summary is not a bullet list, so the caller can
 * fall back to showing it verbatim rather than mangling prose into fake items.
 */
export function parseBullets(summary: string): string[] {
  const items: string[] = [];

  for (const raw of summary.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    // A marker followed by a space; "-not a bullet" is a sentence.
    const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet?.[1]) {
      items.push(bullet[1].trim());
    } else if (items.length > 0) {
      // A wrapped continuation of the bullet above it.
      items[items.length - 1] += ` ${line}`;
    }
  }

  return items;
}
