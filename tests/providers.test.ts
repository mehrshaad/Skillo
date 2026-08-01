import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@/lib/errors';
import { createAnthropicProvider } from '@/lib/providers/anthropic';
import { createOpenAICompatibleProvider } from '@/lib/providers/openaiCompatible';

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const openai = () =>
  createOpenAICompatibleProvider({
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
  });

const anthropic = () => createAnthropicProvider({ apiKey: 'sk-ant-test', model: 'test-model' });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('OpenAI-compatible provider', () => {
  it('posts a chat completion and returns the text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await openai().complete({
      model: 'gpt-test',
      maxTokens: 100,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.text).toBe('hello');
    expect(res.stopReason).toBe('stop');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('gpt-test');
    expect(body.max_tokens).toBe(100);
    // Current Anthropic models 400 on temperature, and the user may route any
    // model through any provider, so it must never be sent.
    expect(body).not.toHaveProperty('temperature');
  });

  it('adds OpenRouter attribution headers only when configured', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'ok' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    await createOpenAICompatibleProvider({
      id: 'openrouter',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'k',
      model: 'm',
      attribution: { referer: 'https://example.com', title: 'Skillo' },
    }).complete({ model: 'm', maxTokens: 10, messages: [{ role: 'user', content: 'x' }] });

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Title']).toBe('Skillo');
    expect(headers['HTTP-Referer']).toBe('https://example.com');
  });

  it('treats an empty completion as a failure rather than empty output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ choices: [] })));
    await expect(
      openai().complete({ model: 'm', maxTokens: 10, messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ code: ErrorCode.PROVIDER_REQUEST_FAILED });
  });

  it('filters non-chat models out of the picker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: [
            { id: 'gpt-test' },
            { id: 'text-embedding-3-small' },
            { id: 'whisper-1' },
            { id: 'dall-e-3' },
            { id: 'another-chat-model' },
          ],
        }),
      ),
    );

    const models = await openai().listModels!();
    expect(models.map((m) => m.id)).toEqual(['another-chat-model', 'gpt-test']);
  });
});

describe('Anthropic provider', () => {
  it('lifts system messages to the top-level field and sets the required headers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await anthropic().complete({
      model: 'claude-test',
      maxTokens: 500,
      messages: [
        { role: 'system', content: 'You are a resume writer.' },
        { role: 'user', content: 'go' },
      ],
    });

    expect(res.text).toBe('hi');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.system).toBe('You are a resume writer.');
    expect(body.messages).toEqual([{ role: 'user', content: 'go' }]);
    expect(body).not.toHaveProperty('temperature');
  });

  it('concatenates multiple text blocks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          content: [
            { type: 'text', text: 'part one ' },
            { type: 'thinking', thinking: 'ignored' },
            { type: 'text', text: 'part two' },
          ],
        }),
      ),
    );

    const res = await anthropic().complete({
      model: 'm',
      maxTokens: 10,
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(res.text).toBe('part one part two');
  });

  it('normalizes a truncated response to the shared "length" stop reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ content: [{ type: 'text', text: 'cut' }], stop_reason: 'max_tokens' }),
      ),
    );

    const res = await anthropic().complete({
      model: 'm',
      maxTokens: 10,
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(res.stopReason).toBe('length');
  });
});

describe('provider error mapping', () => {
  it('maps 401 to a key problem and does not retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: 'invalid x-api-key' } }, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      anthropic().complete({ model: 'm', maxTokens: 10, messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ code: ErrorCode.PROVIDER_AUTH, detail: 'invalid x-api-key' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 404 to a model problem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'no such model' }, 404)));
    await expect(
      openai().complete({ model: 'nope', maxTokens: 10, messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ code: ErrorCode.PROVIDER_REQUEST_FAILED });
  });

  it('retries a rate limit twice before giving up', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'slow down' } }, 429));
    vi.stubGlobal('fetch', fetchMock);

    const pending = openai().complete({
      model: 'm',
      maxTokens: 10,
      messages: [{ role: 'user', content: 'x' }],
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: ErrorCode.PROVIDER_RATE_LIMIT,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 backoff retries
  });

  it('recovers when a retry succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'recovered' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = openai().complete({
      model: 'm',
      maxTokens: 10,
      messages: [{ role: 'user', content: 'x' }],
    });
    await vi.advanceTimersByTimeAsync(30_000);

    expect((await pending).text).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
