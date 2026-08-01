import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { AppError } from '@/lib/errors';

/** Field name set like a key in a source file — the panel's structural label. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{children}</p>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 font-mono text-xs ' +
    'transition-colors disabled:cursor-not-allowed disabled:opacity-45';
  const variants = {
    primary: 'bg-ink text-paper hover:bg-proof',
    secondary: 'border border-rule bg-paper text-ink hover:border-proof hover:text-proof',
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
      className={`w-full rounded-sm border border-rule bg-white px-2.5 py-1.5 font-mono text-xs
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
      className={`w-full resize-y rounded-sm border border-rule bg-white px-2.5 py-1.5 text-xs
        leading-relaxed text-ink placeholder:text-muted/70 focus:border-proof focus:outline-none ${className}`}
      {...props}
    />
  );
}

export function Chip({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'proof' }) {
  const tones = {
    plain: 'border-rule text-muted',
    proof: 'border-proof/40 bg-proof-wash text-proof',
  } as const;
  return (
    <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${tones[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Errors state what happened and what to do next; `detail` carries the fix.
 */
export function ErrorNote({ error }: { error: AppError }) {
  return (
    <div className="rounded-sm border border-cut/30 bg-cut-wash px-2.5 py-2">
      <Eyebrow>{error.code.replace(/_/g, ' ')}</Eyebrow>
      <p className="mt-1 text-xs text-ink">{error.message}</p>
      {error.detail && <p className="mt-1 text-xs text-muted">{error.detail}</p>}
    </div>
  );
}

export function Note({ children, tone = 'warn' }: { children: ReactNode; tone?: 'warn' | 'proof' }) {
  const tones = {
    warn: 'border-warn/30 bg-warn-wash text-warn',
    proof: 'border-proof/30 bg-proof-wash text-proof',
  } as const;
  return (
    <div className={`rounded-sm border px-2.5 py-2 text-xs ${tones[tone]}`}>{children}</div>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
    />
  );
}
