import { ErrorCode, appError } from '@/lib/errors';
import { getSettings, type Settings } from '@/lib/storage';
import { createAnthropicProvider } from './anthropic';
import { createClaudeCodeProvider } from './claudeCode';
import { createOpenAICompatibleProvider } from './openaiCompatible';
import type { LLMProvider, ProviderId } from './types';

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** Where the user gets a key, shown in Settings. */
  keyUrl?: string;
  needsKey: boolean;
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    needsKey: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    needsKey: true,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    needsKey: true,
  },
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code (local)',
    needsKey: false,
  },
};

const ATTRIBUTION = { referer: 'https://github.com/mehrshaad/Skillo', title: 'Skillo' };

export interface ResolvedProvider {
  provider: LLMProvider;
  model: string;
  meta: ProviderMeta;
}

export function buildProvider(id: ProviderId, settings: Settings): ResolvedProvider {
  const meta = PROVIDER_META[id];

  if (id === 'claude-code') {
    if (!settings.providers.claudeCode?.enabled) {
      throw appError(
        ErrorCode.NO_PROVIDER,
        'Turn on the Claude Code bridge in Settings first.',
      );
    }
    // Claude Code picks its own model; the label is only for display.
    return { provider: createClaudeCodeProvider(), model: 'claude-code', meta };
  }

  const config = settings.providers[id];
  if (!config?.apiKey) {
    throw appError(
      ErrorCode.NO_PROVIDER,
      `Add your ${meta.label} API key in Settings first.`,
    );
  }
  if (!config.model) {
    throw appError(ErrorCode.NO_PROVIDER, `Pick a ${meta.label} model in Settings first.`);
  }

  const provider =
    id === 'anthropic'
      ? createAnthropicProvider({ apiKey: config.apiKey, model: config.model })
      : createOpenAICompatibleProvider({
          id,
          label: meta.label,
          baseUrl:
            id === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1',
          apiKey: config.apiKey,
          model: config.model,
          ...(id === 'openrouter' ? { attribution: ATTRIBUTION } : {}),
        });

  return { provider, model: config.model, meta };
}

export async function getActiveProvider(): Promise<ResolvedProvider> {
  const settings = await getSettings();
  if (!settings.activeProviderId) {
    throw appError(
      ErrorCode.NO_PROVIDER,
      'No model configured yet. Open Settings and add an API key.',
    );
  }
  return buildProvider(settings.activeProviderId, settings);
}
