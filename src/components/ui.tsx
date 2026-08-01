import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { AppError } from '@/lib/errors';

/** Field name set like a key in a source file — the panel's structural label. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
      {children}
    </p>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 font-mono text-xs ' +
    'font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40';
  const variants = {
    primary: 'bg-ink text-paper hover:bg-proof',
    secondary: 'border-2 border-rule bg-paper text-ink hover:border-proof hover:text-proof',
    ghost: 'text-muted hover:text-proof',
  } as const;

  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function TextInput({
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-sm border-2 border-rule bg-white px-2.5 py-1.5 font-mono text-xs
        text-ink placeholder:text-muted/70 focus:border-proof focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function TextArea({
  className = '',
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full resize-y rounded-sm border-2 border-rule bg-white px-2.5 py-1.5 text-xs
        leading-relaxed text-ink placeholder:text-muted/70 focus:border-proof focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function Chip({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'proof' }) {
  const tones = {
    plain: 'border-rule text-muted',
    proof: 'border-proof/50 bg-proof-wash text-proof',
  } as const;
  return (
    <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Errors state what happened and what to do next; `detail` carries the fix.
 */
export function ErrorNote({ error }: { error: AppError }) {
  return (
    <div className="rounded-sm border-l-4 border-cut bg-cut-wash px-2.5 py-2">
      <Eyebrow>{error.code.replace(/_/g, ' ')}</Eyebrow>
      <p className="mt-1 text-xs font-medium text-ink">{error.message}</p>
      {error.detail && <p className="mt-1 text-xs text-muted">{error.detail}</p>}
    </div>
  );
}

export function Note({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'proof' }) {
  const tones = {
    warn: 'border-warn bg-warn-wash text-warn',
    proof: 'border-proof bg-proof-wash text-proof',
  } as const;
  return (
    <div className={`rounded-sm border-l-4 px-2.5 py-2 text-xs ${tones[tone]}`}>{children}</div>
  );
}

/**
 * A stepped level control: N segments, filled up to the current value. Used for
 * both the fit level and the page limit. Radio-group semantics so arrow keys
 * work and screen readers announce it as a choice, not a slider.
 */
export function LevelBar({
  value,
  stops,
  onChange,
  label,
  endLabels,
  disabled = false,
}: {
  value: number;
  stops: number;
  onChange: (value: number) => void;
  label: string;
  endLabels?: [string, string];
  disabled?: boolean;
}) {
  const items = Array.from({ length: stops }, (_, i) => i + 1);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    onChange(Math.min(stops, Math.max(1, value + delta)));
  };

  return (
    <div className="space-y-1">
      <div
        role="radiogroup"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex items-stretch gap-1"
      >
        {items.map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={n === value}
            aria-label={`${label}: ${n} of ${stops}`}
            tabIndex={n === value ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(n)}
            className={`h-2.5 flex-1 rounded-sm transition-colors disabled:opacity-40 ${
              n <= value ? 'bg-proof' : 'bg-rule hover:bg-proof/40'
            }`}
          />
        ))}
      </div>
      {endLabels && (
        <div className="flex justify-between font-mono text-[10px] text-muted">
          <span>{endLabels[0]}</span>
          <span>{endLabels[1]}</span>
        </div>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-2 text-left disabled:opacity-40"
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? 'bg-proof' : 'bg-rule'
        }`}
      >
        <span
          className={`h-3 w-3 rounded-full bg-paper transition-transform ${
            checked ? 'translate-x-3' : ''
          }`}
        />
      </span>
      <span>
        <span className="block text-xs font-medium text-ink">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </span>
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}
