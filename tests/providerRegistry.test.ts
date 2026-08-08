import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, type AppError } from '@/core/errors';
import { PROVIDER_META, buildKeyedProvider } from '@/core/providers/registry';
import { PROVIDER_IDS } from '@/core/providers/types';

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }) as
    unknown as Response;

/** Sends one completion and reports the URL and headers it went to. */
async function callWith(id: 'openrouter' | 'openai' | 'anthropic' | 'huggingface') {
  const fetchMock = vi.fn().mockResolvedValue(
    jsonResponse({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  const { provider, model } = buildKeyedProvider(id, { apiKey: 'k-test', model: 'some/model' });
  await provider.complete({ model, maxTokens: 16, messages: [{ role: 'user', content: 'hi' }] });

  const [url, init] = fetchMock.mock.calls[0]!;
  return { url: url as string, headers: (init as RequestInit).headers as Record<string, string> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PROVIDER_META', () => {
  it('describes every provider id, with no gaps', () => {
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_META[id]).toBeDefined();
      expect(PROVIDER_META[id].label).toBeTruthy();
    }
  });

  it('gives every keyed provider somewhere to get a key', () => {
    for (const id of PROVIDER_IDS) {
      const meta = PROVIDER_META[id];
      if (meta.needsKey) expect(meta.keyUrl).toMatch(/^https:\/\//);
    }
  });
});

describe('buildKeyedProvider', () => {
  it('sends Hugging Face to the Inference Providers router', async () => {
    const { url, headers } = await callWith('huggingface');
    expect(url).toBe('https://router.huggingface.co/v1/chat/completions');
    expect(headers.Authorization).toBe('Bearer k-test');
  });

  it('keeps the other keyed providers on their own endpoints', async () => {
    expect((await callWith('openrouter')).url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((await callWith('openai')).url).toBe('https://api.openai.com/v1/chat/completions');
    expect((await callWith('anthropic')).url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('attributes OpenRouter traffic, and only OpenRouter', async () => {
    expect((await callWith('openrouter')).headers['X-Title']).toBe('Skillo');
    expect((await callWith('huggingface')).headers['X-Title']).toBeUndefined();
  });

  it('refuses a local provider, which needs the bridge rather than a key', () => {
    try {
      buildKeyedProvider('claude-code', { apiKey: 'k', model: 'm' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as AppError).code).toBe(ErrorCode.NO_PROVIDER);
      expect((e as AppError).message).toContain('runs on your machine');
    }
  });

  it('names the provider when the key or the model is missing', () => {
    const missingKey = () => buildKeyedProvider('huggingface', undefined);
    const missingModel = () => buildKeyedProvider('huggingface', { apiKey: 'k', model: '' });

    expect(missingKey).toThrowError(/Hugging Face API key/);
    expect(missingModel).toThrowError(/Pick a Hugging Face model/);
  });
});
