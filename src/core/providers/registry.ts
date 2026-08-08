import { ErrorCode, appError } from '@/core/errors';
import { createAnthropicProvider } from './anthropic';
import { createOpenAICompatibleProvider } from './openaiCompatible';
import type { LLMProvider, ProviderConfig, ProviderId } from './types';

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** Where the user gets a key, shown in Settings. */
  keyUrl?: string;
  needsKey: boolean;
  /**
   * Runs on the user's own machine through the native-messaging bridge. Core
   * cannot reach these and the web app cannot reach them at all, so building
   * one is the extension layer's job.
   */
  local?: boolean;
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
  huggingface: {
    id: 'huggingface',
    label: 'Hugging Face',
    keyUrl: 'https://huggingface.co/settings/tokens',
    needsKey: true,
  },
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code (local)',
    needsKey: false,
    local: true,
  },
};

export interface ResolvedProvider {
  provider: LLMProvider;
  model: string;
  meta: ProviderMeta;
}

/**
 * Anthropic speaks its own wire format; the rest are OpenAI-compatible.
 * Hugging Face's Inference Providers router is too, including `/models`, so it
 * gets the model picker for free.
 */
const BASE_URL: Partial<Record<ProviderId, string>> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  huggingface: 'https://router.huggingface.co/v1',
};

const ATTRIBUTION = { referer: 'https://github.com/mehrshaad/Skillo', title: 'Skillo' };

/**
 * Builds a provider the user reaches with their own key. Everything here works
 * from a plain web page as well as from the extension, which is the point of it
 * living in core: the same Settings screen can drive both.
 */
export function buildKeyedProvider(
  id: ProviderId,
  config: ProviderConfig | undefined,
): ResolvedProvider {
  const meta = PROVIDER_META[id];

  if (meta.local) {
    throw appError(
      ErrorCode.NO_PROVIDER,
      `${meta.label} runs on your machine, so it cannot be built from a key.`,
    );
  }
  if (!config?.apiKey) {
    throw appError(ErrorCode.NO_PROVIDER, `Add your ${meta.label} API key in Settings first.`);
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
          baseUrl: BASE_URL[id]!,
          apiKey: config.apiKey,
          model: config.model,
          ...(id === 'openrouter' ? { attribution: ATTRIBUTION } : {}),
        });

  return { provider, model: config.model, meta };
}
