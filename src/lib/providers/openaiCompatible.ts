import { ErrorCode, appError } from '@/lib/errors';
import { providerFetch } from './http';
import type {
  CompletionRequest,
  CompletionResponse,
  LLMProvider,
  ModelInfo,
  ProviderId,
} from './types';

interface ChatCompletionResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
}

interface ModelsResponse {
  data?: { id?: string; name?: string }[];
}

/** Model ids that are not chat models and only clutter the picker. */
const NON_CHAT = /embedding|whisper|tts|dall-e|moderation|audio|image|realtime|transcribe/i;

/**
 * OpenRouter and OpenAI share the same wire format, so one client covers both —
 * only the base URL and a couple of optional headers differ.
 */
export function createOpenAICompatibleProvider(opts: {
  id: ProviderId;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** OpenRouter attributes traffic with these; harmless elsewhere. */
  attribution?: { referer: string; title: string };
}): LLMProvider {
  const headers = (): Record<string, string> => {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    };
    if (opts.attribution) {
      h['HTTP-Referer'] = opts.attribution.referer;
      h['X-Title'] = opts.attribution.title;
    }
    return h;
  };

  return {
    id: opts.id,

    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResponse> {
      const json = (await providerFetch(
        `${opts.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: headers(),
          signal: signal ?? null,
          body: JSON.stringify({
            model: req.model,
            max_tokens: req.maxTokens,
            messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          }),
        },
        opts.label,
      )) as ChatCompletionResponse;

      const choice = json.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== 'string' || !text.trim()) {
        throw appError(
          ErrorCode.PROVIDER_REQUEST_FAILED,
          `${opts.label} returned an empty response.`,
          JSON.stringify(json).slice(0, 300),
        );
      }

      return { text, stopReason: choice?.finish_reason };
    },

    async listModels(): Promise<ModelInfo[]> {
      const json = (await providerFetch(
        `${opts.baseUrl}/models`,
        { method: 'GET', headers: headers() },
        opts.label,
      )) as ModelsResponse;

      return (json.data ?? [])
        .filter((m): m is { id: string; name?: string } => typeof m.id === 'string')
        .filter((m) => !NON_CHAT.test(m.id))
        .map((m) => ({ id: m.id, name: m.name ?? m.id }))
        .sort((a, b) => a.id.localeCompare(b.id));
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
