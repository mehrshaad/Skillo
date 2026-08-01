import { useEffect, useState } from 'react';
import { sendMessage } from '@/lib/messages';
import { onStateChange, type WizardState, type WizardStep } from '@/lib/state';
import { getSettings, type Settings as SettingsData } from '@/lib/storage';
import { JobStep } from '@/components/JobStep';
import { ResumeStep } from '@/components/ResumeStep';
import { TailorStep } from '@/components/TailorStep';
import { ReviewStep } from '@/components/ReviewStep';
import { Settings } from '@/components/Settings';
import { History } from '@/components/History';
import { Button } from '@/components/ui';

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'job', label: 'Job' },
  { id: 'resume', label: 'Resume' },
  { id: 'tailor', label: 'Tailor' },
  { id: 'review', label: 'Review' },
];

/** A step is reachable once the step before it has what it needs. */
function isReachable(step: WizardStep, state: WizardState): boolean {
  switch (step) {
    case 'job':
      return true;
    case 'resume':
      return Boolean(state.job);
    case 'tailor':
      return Boolean(state.job && state.resume);
    case 'review':
      return Boolean(state.generation.result);
  }
}

export default function App() {
  const [state, setState] = useState<WizardState | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [overlay, setOverlay] = useState<null | 'settings' | 'history'>(null);

  const refreshSettings = () => void getSettings().then(setSettings);

  useEffect(() => {
    void sendMessage({ type: 'state/get' }).then((res) => {
      if (res.ok) setState(res.data);
    });
    refreshSettings();
    return onStateChange(setState);
  }, []);

  if (!state) return <div className="p-4 text-xs text-muted">Loading…</div>;

  if (overlay === 'settings') {
    return (
      <Shell>
        <Settings
          onClose={() => {
            refreshSettings();
            setOverlay(null);
          }}
        />
      </Shell>
    );
  }

  if (overlay === 'history') {
    return (
      <Shell>
        <History onClose={() => setOverlay(null)} />
      </Shell>
    );
  }

  const goTo = (step: WizardStep) => void sendMessage({ type: 'state/update', patch: { step } });
  const activeIndex = STEPS.findIndex((s) => s.id === state.step);
  const next = STEPS[activeIndex + 1];
  const previous = STEPS[activeIndex - 1];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline justify-between border-b border-rule px-4 py-3">
        <h1 className="font-mono text-[15px] font-bold tracking-tight">skillo</h1>
        <div className="flex gap-3">
          <button
            onClick={() => setOverlay('history')}
            className="font-mono text-[10px] text-muted underline hover:text-proof"
          >
            history
          </button>
          <button
            onClick={() => setOverlay('settings')}
            className="font-mono text-[10px] text-muted underline hover:text-proof"
          >
            {settings?.activeProviderId ?? 'set up a model'}
          </button>
        </div>
      </header>

      <nav className="flex border-b border-rule" aria-label="Progress">
        {STEPS.map((step, i) => {
          const reachable = isReachable(step.id, state);
          const active = i === activeIndex;
          return (
            <button
              key={step.id}
              disabled={!reachable}
              onClick={() => goTo(step.id)}
              aria-current={active ? 'step' : undefined}
              className={`flex-1 border-t-[3px] px-2 py-2 text-left font-mono text-[10px] ${
                active
                  ? 'border-proof font-bold text-ink'
                  : reachable
                    ? 'border-proof/40 font-medium text-proof'
                    : 'border-transparent text-muted/50'
              }`}
            >
              {i + 1} {step.label}
            </button>
          );
        })}
      </nav>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        {state.step === 'job' && (
          <JobStep
            job={state.job}
            profile={state.jobProfile}
            analyzing={state.generation.status === 'analyzing'}
          />
        )}
        {state.step === 'resume' && <ResumeStep resume={state.resume} />}
        {state.step === 'tailor' && <TailorStep state={state} />}
        {state.step === 'review' && <ReviewStep state={state} />}
      </main>

      <footer className="flex items-center justify-between border-t border-rule px-4 py-2">
        <Button
          variant="ghost"
          disabled={!previous}
          onClick={() => previous && goTo(previous.id)}
        >
          ← back
        </Button>
        <button
          className="font-mono text-[10px] text-muted underline hover:text-cut"
          onClick={() => void sendMessage({ type: 'state/reset' })}
        >
          start over
        </button>
        <Button
          disabled={!next || !isReachable(next.id, state)}
          onClick={() => next && goTo(next.id)}
        >
          continue →
        </Button>
      </footer>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-rule px-4 py-3">
        <h1 className="font-mono text-[15px] font-bold tracking-tight">skillo</h1>
      </header>
      <main className="flex-1 overflow-y-auto px-4 py-4">{children}</main>
    </div>
  );
}
