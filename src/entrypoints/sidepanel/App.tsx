import { useEffect, useState } from 'react';
import { sendMessage } from '@/lib/messages';
import { onStateChange, type WizardState, type WizardStep } from '@/lib/state';
import { getSettings, type Settings } from '@/lib/storage';
import { JobStep } from '@/components/JobStep';
import { Eyebrow } from '@/components/ui';

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'job', label: 'Job' },
  { id: 'resume', label: 'Resume' },
  { id: 'tailor', label: 'Tailor' },
  { id: 'review', label: 'Review' },
];

export default function App() {
  const [state, setState] = useState<WizardState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void sendMessage({ type: 'state/get' }).then((res) => {
      if (res.ok) setState(res.data);
    });
    void getSettings().then(setSettings);
    return onStateChange(setState);
  }, []);

  if (!state) return <div className="p-4 text-xs text-muted">Loading…</div>;

  const activeIndex = STEPS.findIndex((s) => s.id === state.step);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline justify-between border-b border-rule px-4 py-3">
        <h1 className="font-mono text-sm tracking-tight">skillo</h1>
        <span className="font-mono text-[10px] text-muted">
          {settings?.activeProviderId ?? 'no model configured'}
        </span>
      </header>

      <nav className="flex border-b border-rule" aria-label="Progress">
        {STEPS.map((step, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <div
              key={step.id}
              aria-current={active ? 'step' : undefined}
              className={`flex-1 border-t-2 px-2 py-2 ${
                active ? 'border-proof' : done ? 'border-proof/35' : 'border-transparent'
              }`}
            >
              <span
                className={`font-mono text-[10px] ${
                  active ? 'text-ink' : done ? 'text-proof' : 'text-muted/60'
                }`}
              >
                {i + 1} {step.label}
              </span>
            </div>
          );
        })}
      </nav>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        {state.step === 'job' && <JobStep job={state.job} />}
        {state.step !== 'job' && <Placeholder step={state.step} />}
      </main>
    </div>
  );
}

function Placeholder({ step }: { step: WizardStep }) {
  return (
    <div className="space-y-2">
      <Eyebrow>{step}</Eyebrow>
      <p className="text-xs text-muted">This step lands in the next milestone.</p>
      <button
        className="font-mono text-xs text-proof underline"
        onClick={() => void sendMessage({ type: 'state/update', patch: { step: 'job' } })}
      >
        back to job
      </button>
    </div>
  );
}
