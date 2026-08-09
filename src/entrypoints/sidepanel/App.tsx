import { useEffect, useState } from 'react';
import { sendMessage } from '@/lib/messages';
import { onStateChange, type WizardState, type WizardStep } from '@/lib/state';
import { getSettings, saveSettings, type Settings as SettingsData } from '@/lib/storage';
import { JobStep } from '@/components/JobStep';
import { ResumeStep } from '@/components/ResumeStep';
import { TailorStep } from '@/components/TailorStep';
import { ReviewStep } from '@/components/ReviewStep';
import { Settings } from '@/components/Settings';
import { History } from '@/components/History';
import { Profile } from '@/components/Profile';
import { Tour } from '@/components/Tour';
import { Button, ErrorNote, Spinner, SwapText } from '@/components/ui';
import { applyRevision } from '@/lib/applyRevision';
import { isProfileEmpty } from '@/core/profile';
import { getProfile } from '@/lib/profileStore';
import { STEPS, footerAction, isReachable, type FooterAction } from '@/lib/wizardNav';
import type { AppError } from '@/core/errors';

/** Generating is still "continue" from the user's side: same button, same word. */
const FOOTER_LABEL: Record<FooterAction, string> = {
  apply: 'apply →',
  applied: 'applied',
  generate: 'continue →',
  next: 'continue →',
};

export default function App() {
  const [state, setState] = useState<WizardState | null>(null);
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [overlay, setOverlay] = useState<null | 'settings' | 'history' | 'profile'>(null);
  const [profileEmpty, setProfileEmpty] = useState(false);
  /** Undefined until settings load, so the tour never flashes on a return visit. */
  const [tourDone, setTourDone] = useState<boolean | undefined>(undefined);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<AppError | null>(null);
  /** Null until edited, so the draft falls through to whatever the last run used. */
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<AppError | null>(null);

  const refreshSettings = () =>
    void getSettings().then((s) => {
      setSettings(s);
      setTourDone(Boolean(s.ui?.tourDoneAt));
    });
  const refreshProfile = () => void getProfile().then((p) => setProfileEmpty(isProfileEmpty(p)));

  useEffect(() => {
    void sendMessage({ type: 'state/get' }).then((res) => {
      if (res.ok) setState(res.data);
    });
    refreshSettings();
    refreshProfile();
    return onStateChange(setState);
  }, []);

  if (!state || tourDone === undefined) {
    return <div className="p-4 text-xs text-muted">Loading…</div>;
  }

  const finishTour = () => {
    setTourDone(true);
    void getSettings().then((s) =>
      saveSettings({ ui: { ...s.ui, tourDoneAt: new Date().toISOString() } }),
    );
  };

  if (!tourDone) {
    return (
      <Shell>
        <Tour onDone={finishTour} onOpen={setOverlay} />
      </Shell>
    );
  }

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

  if (overlay === 'profile') {
    return (
      <Shell>
        <Profile
          onClose={() => {
            refreshProfile();
            setOverlay(null);
          }}
        />
      </Shell>
    );
  }

  const goTo = (step: WizardStep) => void sendMessage({ type: 'state/update', patch: { step } });
  const activeIndex = STEPS.findIndex((s) => s.id === state.step);
  const next = STEPS[activeIndex + 1];
  const previous = STEPS[activeIndex - 1];
  const notes = notesDraft ?? state.notes;
  const generating =
    state.generation.status === 'analyzing' || state.generation.status === 'tailoring';
  const footer = footerAction(state, { applying, generating });

  const applyNow = async () => {
    setApplying(true);
    setApplyError(null);
    const res = await applyRevision(state);
    if (!res.ok) setApplyError(res.error);
    setApplying(false);
  };

  const generate = async () => {
    setGenerateError(null);
    const res = await sendMessage({ type: 'pipeline/tailor', notes });
    if (!res.ok) setGenerateError(res.error);
  };

  const startOver = () => {
    setNotesDraft(null);
    setGenerateError(null);
    setApplyError(null);
    void sendMessage({ type: 'state/reset' });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline justify-between border-b border-rule px-4 py-3">
        <h1 className="font-mono text-[15px] font-bold tracking-tight">skillo</h1>
        <div className="flex gap-3">
          <button
            onClick={() => setOverlay('profile')}
            className={`font-mono text-[10px] underline hover:text-proof ${
              profileEmpty ? 'font-semibold text-proof' : 'text-muted'
            }`}
          >
            {profileEmpty ? 'about you →' : 'about you'}
          </button>
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
          <button
            onClick={() => setTourDone(false)}
            title="Replay the introduction"
            className="font-mono text-[10px] text-muted underline hover:text-proof"
          >
            ?
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

      {/* Keyed by step so the entry animation replays on each move. */}
      <main key={state.step} className="step-enter flex-1 overflow-y-auto px-4 py-4">
        {state.step === 'job' && (
          <JobStep
            job={state.job}
            profile={state.jobProfile}
            analyzing={state.generation.status === 'analyzing'}
          />
        )}
        {state.step === 'resume' && <ResumeStep resume={state.resume} />}
        {state.step === 'tailor' && (
          <TailorStep
            state={state}
            notes={notes}
            error={generateError}
            onNotesChange={setNotesDraft}
            onGenerate={() => void generate()}
          />
        )}
        {state.step === 'review' && <ReviewStep state={state} />}
      </main>

      <footer className="border-t border-rule px-4 py-2">
        {applyError && (
          <div className="pb-2">
            <ErrorNote error={applyError} />
          </div>
        )}

        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            disabled={!previous}
            onClick={() => previous && goTo(previous.id)}
          >
            ← back
          </Button>
          <button
            className="font-mono text-[10px] text-muted underline hover:text-cut"
            onClick={startOver}
          >
            start over
          </button>

          <Button
            disabled={footer.disabled}
            onClick={() => {
              if (footer.action === 'apply') void applyNow();
              else if (footer.action === 'generate') void generate();
              else if (next) goTo(next.id);
            }}
          >
            {(applying || (footer.action === 'generate' && generating)) && <Spinner />}
            <SwapText>{FOOTER_LABEL[footer.action]}</SwapText>
          </Button>
        </div>
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
