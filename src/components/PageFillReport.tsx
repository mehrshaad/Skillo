import { useState } from 'react';
import { Button, SectionHeader, Spinner } from './ui';

const STEP = 0.1;
const MIN = 0.2;
/** Close enough to the limit that there is nothing worth regenerating for. */
const TOLERANCE = 0.1;

/**
 * You can see how full the page is; Skillo cannot — Overleaf's viewer renders no
 * text layer and virtualizes its canvases, so there is nothing to measure (see
 * docs/findings.md).
 *
 * So you tell it. A reported fraction is strictly better than the page count
 * Skillo can read for itself: an integer only says "somewhere between one and
 * two pages", whereas "1.3" pins how much text a page of this template holds.
 * One drag calibrates every future run on this template.
 */
export function PageFillReport({
  title,
  pageLimit,
  defaultValue,
  actionable = false,
  onSubmit,
}: {
  title: string;
  /** Only meaningful where a target exists; omitted when simply calibrating. */
  pageLimit?: number;
  defaultValue: number;
  /** Whether falling short or overshooting can be acted on by regenerating. */
  actionable?: boolean;
  onSubmit: (actualPages: number, action: 'none' | 'fill' | 'trim') => Promise<void>;
}) {
  const [value, setValue] = useState(() =>
    Math.max(MIN, Math.round(defaultValue * 10) / 10),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const max = Math.max((pageLimit ?? 2) + 1, 3);
  const target = pageLimit ?? 0;
  const short = actionable && value < target - TOLERANCE;
  const over = actionable && value > target + TOLERANCE;
  const action = short ? 'fill' : over ? 'trim' : 'none';

  const pages = `${target} ${target === 1 ? 'page' : 'pages'}`;
  const label =
    action === 'fill'
      ? `Fill out to ${pages}`
      : action === 'trim'
        ? `Trim to ${pages}`
        : 'Save this reading';

  const submit = async () => {
    setBusy(true);
    setSaved(false);
    await onSubmit(value, action);
    setBusy(false);
    if (action === 'none') setSaved(true);
  };

  return (
    <section className="space-y-2">
      <SectionHeader meta={pageLimit === undefined ? undefined : `limit ${pageLimit}`}>
        {title}
      </SectionHeader>

      <div className="flex items-center gap-3">
        <input
          type="range"
          min={MIN}
          max={max}
          step={STEP}
          value={value}
          disabled={busy}
          aria-label="Pages it actually came out as"
          aria-valuetext={`${value.toFixed(1)} pages`}
          onChange={(e) => {
            setValue(Number(e.target.value));
            setSaved(false);
          }}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-rule accent-proof"
        />
        <span className="w-16 shrink-0 text-right font-mono text-sm font-bold text-proof">
          {value.toFixed(1)}
        </span>
      </div>

      <div className="flex justify-between font-mono text-[10px] text-muted">
        <span>{MIN}</span>
        <span>drag to what you actually see</span>
        <span>{max}</span>
      </div>

      <Button disabled={busy} onClick={() => void submit()}>
        {busy ? <Spinner /> : null}
        {label}
      </Button>

      {saved && (
        <p className="font-mono text-[10px] text-add">
          saved — future runs on this template will use it
        </p>
      )}
    </section>
  );
}
