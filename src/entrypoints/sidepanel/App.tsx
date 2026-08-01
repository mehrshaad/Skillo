import { useEffect, useState } from 'react';
import { sendMessage } from '@/lib/messages';
import { onStateChange, type WizardState } from '@/lib/state';
import { getSettings, type Settings } from '@/lib/storage';

const STEPS = ['job', 'resume', 'tailor', 'review'] as const;

export default function App() {
  const [state, setState] = useState<WizardState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    sendMessage({ type: 'state/get' }).then((res) => {
      if (res.ok) setState(res.data);
    });
    getSettings().then(setSettings);
    return onStateChange(setState);
  }, []);

  return (
    <div className="flex h-full flex-col bg-white text-sm text-slate-900">
      <header className="border-b border-slate-200 px-4 py-3">
        <h1 className="font-semibold">Skillo</h1>
        <p className="text-xs text-slate-500">
          {settings?.activeProviderId
            ? `Provider: ${settings.activeProviderId}`
            : 'No provider configured yet'}
        </p>
      </header>

      <nav className="flex gap-1 border-b border-slate-200 px-4 py-2 text-xs">
        {STEPS.map((step) => (
          <span
            key={step}
            className={
              state?.step === step
                ? 'rounded bg-slate-900 px-2 py-1 text-white'
                : 'rounded px-2 py-1 text-slate-500'
            }
          >
            {step}
          </span>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto p-4">
        <p className="text-slate-500">Scaffold ready. Job intake lands in the next milestone.</p>
      </main>
    </div>
  );
}
