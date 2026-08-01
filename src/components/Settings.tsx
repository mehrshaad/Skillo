import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { ErrorCode, appError, type AppError } from '@/lib/errors';
import { sendMessage } from '@/lib/messages';
import type { BridgeStatus } from '@/lib/providers/claudeCode';
import { PROVIDER_META } from '@/lib/providers/registry';
import { PROVIDER_IDS, type ModelInfo, type ProviderId } from '@/lib/providers/types';
import { getSettings, saveSettings, type Settings as SettingsData } from '@/lib/storage';
import { Button, Chip, ErrorNote, Eyebrow, Note, Spinner, TextInput } from './ui';

export function Settings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [selected, setSelected] = useState<ProviderId>('openrouter');

  useEffect(() => {
    void getSettings().then((s) => {
      setSettings(s);
      if (s.activeProviderId) setSelected(s.activeProviderId);
    });
  }, []);

  if (!settings) return <p className="text-xs text-muted">Loading…</p>;

  const update = async (patch: Partial<SettingsData>) => {
    setSettings(await saveSettings(patch));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Eyebrow>Settings</Eyebrow>
        <Button variant="ghost" onClick={onClose}>
          done
        </Button>
      </div>

      <section className="space-y-2">
        <Eyebrow>Model provider</Eyebrow>
        <div className="grid grid-cols-2 gap-1.5">
          {PROVIDER_IDS.map((id) => {
            const configured =
              id === 'claude-code'
                ? settings.providers.claudeCode?.enabled
                : Boolean(settings.providers[id]?.apiKey);
            return (
              <button
                key={id}
                onClick={() => setSelected(id)}
                className={`rounded-sm border px-2 py-1.5 text-left font-mono text-[11px] ${
                  selected === id
                    ? 'border-proof bg-proof-wash text-proof'
                    : 'border-rule text-muted hover:border-proof'
                }`}
              >
                {PROVIDER_META[id].label}
                {configured && <span className="ml-1 text-add">✓</span>}
              </button>
            );
          })}
        </div>
      </section>

      {selected === 'claude-code' ? (
        <ClaudeCodeForm
          settings={settings}
          onSave={update}
          isActive={settings.activeProviderId === 'claude-code'}
        />
      ) : (
        <ProviderForm
          key={selected}
          providerId={selected}
          settings={settings}
          onSave={update}
          isActive={settings.activeProviderId === selected}
        />
      )}

      <p className="border-t border-rule pt-3 text-xs text-muted">
        Keys are stored unencrypted in Chrome's local extension storage on this machine, and are
        sent only to the provider you selected. Your resume and the job text are sent to that
        provider when you generate.
      </p>
    </div>
  );
}

function ClaudeCodeForm({
  settings,
  onSave,
  isActive,
}: {
  settings: SettingsData;
  onSave: (patch: Partial<SettingsData>) => Promise<void>;
  isActive: boolean;
}) {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const refresh = async () => {
    setBusy(true);
    const res = await sendMessage({ type: 'bridge/status' });
    if (res.ok) setStatus(res.data);
    else setError(res.error);
    setBusy(false);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setError(null);
    setBusy(true);
    // Must be called from a user gesture, so it lives here rather than in the worker.
    const granted = await browser.permissions.request({ permissions: ['nativeMessaging'] });
    setBusy(false);
    if (!granted) {
      setError(
        appError(
          ErrorCode.PERMISSION_DENIED,
          'Skillo needs Chrome\'s native messaging permission to reach Claude Code.',
          'Press Connect again to see the prompt, or use an API key provider instead.',
        ),
      );
      return;
    }
    await refresh();
  };

  const ready = status?.installed && status.claudeFound;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Runs Skillo's prompts through the Claude Code already installed on this machine, using
        your existing login. No API key, and nothing goes to a third-party provider.
      </p>

      <section className="space-y-1.5">
        <Eyebrow>Bridge status</Eyebrow>
        {busy && !status ? (
          <p className="text-xs text-muted">Checking…</p>
        ) : ready ? (
          <div className="flex flex-wrap items-center gap-1">
            <Chip tone="proof">connected</Chip>
            <Chip>host {status.version}</Chip>
            <Chip>claude found</Chip>
          </div>
        ) : status?.installed ? (
          <Note>
            The bridge is running, but it cannot find the <code>claude</code> command. Install
            Claude Code, or make sure <code>claude</code> is on your PATH, then re-check.
          </Note>
        ) : (
          <Note>
            Not connected. Run the installer in the extension's <code>bridge/</code> folder — see
            <code> bridge/README.md</code> — then press Connect.
          </Note>
        )}
      </section>

      <div className="flex gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void connect()}>
          {busy ? <Spinner /> : null}
          {status?.installed ? 'Re-check' : 'Connect'}
        </Button>
      </div>

      {error && <ErrorNote error={error} />}

      <Button
        disabled={!ready || isActive}
        onClick={() =>
          void onSave({
            activeProviderId: 'claude-code',
            providers: { ...settings.providers, claudeCode: { enabled: true } },
          })
        }
      >
        {isActive ? 'Claude Code is active' : 'Use Claude Code'}
      </Button>
    </div>
  );
}

function ProviderForm({
  providerId,
  settings,
  onSave,
  isActive,
}: {
  providerId: Exclude<ProviderId, 'claude-code'>;
  settings: SettingsData;
  onSave: (patch: Partial<SettingsData>) => Promise<void>;
  isActive: boolean;
}) {
  const meta = PROVIDER_META[providerId];
  const config = settings.providers[providerId];

  const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
  const [model, setModel] = useState(config?.model ?? '');
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [tested, setTested] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [filter, setFilter] = useState('');

  const persist = async (next: { apiKey: string; model: string }) => {
    await onSave({ providers: { [providerId]: next } });
  };

  const loadModels = async () => {
    setBusy('models');
    setError(null);
    await persist({ apiKey, model });
    const res = await sendMessage({ type: 'provider/listModels', providerId });
    if (res.ok) setModels(res.data);
    else setError(res.error);
    setBusy(null);
  };

  const testConnection = async () => {
    setBusy('test');
    setError(null);
    setTested(false);
    await persist({ apiKey, model });
    const res = await sendMessage({ type: 'provider/test', providerId });
    if (res.ok) setTested(true);
    else setError(res.error);
    setBusy(null);
  };

  const visible = models?.filter((m) =>
    filter ? m.id.toLowerCase().includes(filter.toLowerCase()) : true,
  );

  return (
    <div className="space-y-3">
      <section className="space-y-1.5">
        <Eyebrow>API key</Eyebrow>
        <TextInput
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setTested(false);
          }}
          onBlur={() => void persist({ apiKey, model })}
          placeholder="paste your key"
          autoComplete="off"
          spellCheck={false}
          aria-label={`${meta.label} API key`}
        />
        {meta.keyUrl && (
          <a
            href={meta.keyUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[10px] text-proof underline"
          >
            get a key →
          </a>
        )}
      </section>

      <section className="space-y-1.5">
        <Eyebrow>Model</Eyebrow>
        <TextInput
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setTested(false);
          }}
          onBlur={() => void persist({ apiKey, model })}
          placeholder="model id"
          spellCheck={false}
          aria-label="Model id"
        />
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!apiKey || busy !== null} onClick={loadModels}>
            {busy === 'models' ? <Spinner /> : null}
            Browse models
          </Button>
          <Button
            variant="secondary"
            disabled={!apiKey || !model || busy !== null}
            onClick={testConnection}
          >
            {busy === 'test' ? <Spinner /> : null}
            Test connection
          </Button>
        </div>
      </section>

      {visible && (
        <section className="space-y-1.5">
          <TextInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`filter ${models?.length ?? 0} models`}
            aria-label="Filter models"
          />
          <ul className="max-h-40 overflow-y-auto rounded-sm border border-rule">
            {visible.slice(0, 100).map((m) => (
              <li key={m.id}>
                <button
                  className="block w-full px-2 py-1 text-left font-mono text-[11px] hover:bg-proof-wash"
                  onClick={() => {
                    setModel(m.id);
                    setTested(false);
                    void persist({ apiKey, model: m.id });
                  }}
                >
                  {m.id}
                </button>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="px-2 py-1 text-xs text-muted">No model matches that filter.</li>
            )}
          </ul>
        </section>
      )}

      {error && <ErrorNote error={error} />}
      {tested && (
        <div className="flex items-center gap-2">
          <Chip tone="proof">connection works</Chip>
        </div>
      )}

      <Button
        disabled={!apiKey || !model || isActive}
        onClick={() => void onSave({ activeProviderId: providerId })}
      >
        {isActive ? `${meta.label} is active` : `Use ${meta.label}`}
      </Button>
    </div>
  );
}
