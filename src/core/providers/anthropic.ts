import { ErrorCode, appError } from '@/core/errors';
import { providerFetch } from './http';
import type { CompletionRequest, CompletionResponse, LLMProvider, ModelInfo } from './types';

const BASE_URL = 'https://api.anthropic.com/v1';
const API_VERSION = '2023-06-01';

interface MessagesResponse {
  content?: { type?: string; text?: string }[];
  stop_reason?: string;
}

interface ModelsResponse {
  data?: { id?: string; display_name?: string }[];
}

export function createAnthropicProvider(opts: {
  apiKey: string;
  model: string;
}): LLMProvider {
  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    'x-api-key': opts.apiKey,
    'anthropic-version': API_VERSION,
    // Extension fetches already bypass CORS via host_permissions; this makes
    // the browser-origin case explicit rather than relying on that.
    'anthropic-dangerous-direct-browser-access': 'true',
  });

  return {
    id: 'anthropic',

    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
      // Anthropic takes the system prompt as a top-level field, not a message.
      const system = req.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const messages = req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }));

      const json = (await providerFetch(
        `${BASE_URL}/messages`,
        {
          method: 'POST',
          headers: headers(),
          signal: signal ?? null,
          body: JSON.stringify({
            model: req.model,
            max_tokens: req.maxTokens,
            ...(system ? { system } : {}),
            messages,
          }),
        },
        'Anthropic',
      )) as MessagesResponse;

      const text = (json.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('');

      if (!text.trim()) {
        throw appError(
          ErrorCode.PROVIDER_REQUEST_FAILED,
          'Anthropic returned an empty response.',
          JSON.stringify(json).slice(0, 300),
        );
      }

      // Normalize to the same vocabulary the OpenAI-shaped clients use.
      return { text, stopReason: json.stop_reason === 'max_tokens' ? 'length' : json.stop_reason };
    },

    async listModels(): Promise<ModelInfo[]> {
      const json = (await providerFetch(
        `${BASE_URL}/models?limit=100`,
        { method: 'GET', headers: headers() },
        'Anthropic',
      )) as ModelsResponse;

      return (json.data ?? [])
        .filter((m): m is { id: string; display_name?: string } => typeof m.id === 'string')
        .map((m) => ({ id: m.id, name: m.display_name ?? m.id }));
    },

    async test(): Promise<void> {
      await this.complete({
        model: opts.model,
        maxTokens: 16,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      });
    },
  };
}
