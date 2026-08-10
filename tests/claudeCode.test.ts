import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ErrorCode } from '@/core/errors';
import {
  createClaudeCodeProvider,
  createCodexProvider,
  getBridgeStatus,
} from '@/lib/providers/claudeCode';

type Listener = (msg: unknown) => void;

/** Stands in for the native messaging port Chrome hands back. */
function stubPort() {
  const messageListeners: Listener[] = [];
  const disconnectListeners: (() => void)[] = [];

  const port = {
    onMessage: { addListener: (fn: Listener) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn: () => void) => disconnectListeners.push(fn) },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
  };

  return {
    port,
    reply: (msg: unknown) => messageListeners.forEach((fn) => fn(msg)),
    drop: () => disconnectListeners.forEach((fn) => fn()),
    sent: () => port.postMessage.mock.calls[0]?.[0] as Record<string, unknown> | undefined,
  };
}

/** `permissions.contains` is overloaded with a callback form, hence the cast. */
function stubPermission(granted: boolean) {
  vi.spyOn(fakeBrowser.permissions, 'contains').mockImplementation(
    (async () => granted) as never,
  );
}

function installPort() {
  const stub = stubPort();
  const runtime = fakeBrowser.runtime as unknown as Record<string, unknown>;
  runtime.connectNative = vi.fn(() => stub.port);
  return stub;
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('Claude Code provider', () => {
  it('flattens the conversation into a system prompt and one prompt', async () => {
    const stub = installPort();
    const provider = createClaudeCodeProvider();

    const pending = provider.complete({
      model: 'claude-code',
      maxTokens: 100,
      messages: [
        { role: 'system', content: 'You are a resume writer.' },
        { role: 'user', content: 'Tailor this.' },
        { role: 'assistant', content: 'Here is version one.' },
        { role: 'user', content: 'Make it shorter.' },
      ],
    });

    stub.reply({ ok: true, text: 'done', stopReason: 'end_turn' });
    const result = await pending;

    expect(result.text).toBe('done');

    const sent = stub.sent()!;
    expect(sent.type).toBe('complete');
    expect(sent.system).toBe('You are a resume writer.');
    expect(sent.prompt).toContain('Tailor this.');
    expect(sent.prompt).toContain('Your previous reply was:');
    expect(sent.prompt).toContain('Make it shorter.');
    // The system prompt travels in its own field, not inside the prompt.
    expect(sent.prompt).not.toContain('You are a resume writer.');
  });

  it('maps a bridge error code through unchanged', async () => {
    const stub = installPort();
    const pending = createClaudeCodeProvider().complete({
      model: 'claude-code',
      maxTokens: 10,
      messages: [{ role: 'user', content: 'x' }],
    });

    stub.reply({
      ok: false,
      error: { code: 'BRIDGE_CLI_NOT_FOUND', message: 'no claude here', detail: 'PATH' },
    });

    await expect(pending).rejects.toMatchObject({
      code: ErrorCode.BRIDGE_CLI_NOT_FOUND,
      message: 'no claude here',
      detail: 'PATH',
    });
  });

  it('falls back to a generic bridge failure for an unrecognized code', async () => {
    const stub = installPort();
    const pending = createClaudeCodeProvider().complete({
      model: 'claude-code',
      maxTokens: 10,
      messages: [{ role: 'user', content: 'x' }],
    });

    stub.reply({ ok: false, error: { code: 'SOMETHING_NEW', message: 'odd' } });
    await expect(pending).rejects.toMatchObject({ code: ErrorCode.BRIDGE_FAILED });
  });

  it('treats a dropped port as the host not being installed', async () => {
    const stub = installPort();
    const pending = createClaudeCodeProvider().complete({
      model: 'claude-code',
      maxTokens: 10,
      messages: [{ role: 'user', content: 'x' }],
    });

    stub.drop();
    await expect(pending).rejects.toMatchObject({ code: ErrorCode.BRIDGE_NOT_INSTALLED });
  });

  it('rejects an empty completion rather than returning nothing', async () => {
    const stub = installPort();
    const pending = createClaudeCodeProvider().complete({
      model: 'claude-code',
      maxTokens: 10,
      messages: [{ role: 'user', content: 'x' }],
    });

    stub.reply({ ok: true, text: '   ' });
    await expect(pending).rejects.toMatchObject({ code: ErrorCode.BRIDGE_FAILED });
  });
});

describe('getBridgeStatus', () => {
  it('reports not installed when the permission has not been granted', async () => {
    stubPermission(false);
    expect(await getBridgeStatus()).toEqual({ installed: false });
  });

  it('reports the host version and whether claude was found', async () => {
    stubPermission(true);
    const stub = installPort();

    const pending = getBridgeStatus();
    // getBridgeStatus checks the permission first, so the port is only
    // connected a tick later — wait for it before answering.
    await vi.waitFor(() => expect(stub.port.postMessage).toHaveBeenCalled());
    stub.reply({ ok: true, version: '0.1.0', claudeFound: true, claudePath: '/usr/bin/claude' });

    expect(await pending).toEqual({
      installed: true,
      version: '0.1.0',
      claudeFound: true,
      claudePath: '/usr/bin/claude',
    });
  });

  it('reports not installed when the host cannot be reached', async () => {
    stubPermission(true);
    const stub = installPort();

    const pending = getBridgeStatus();
    await vi.waitFor(() => expect(stub.port.postMessage).toHaveBeenCalled());
    stub.drop();

    expect(await pending).toEqual({ installed: false });
  });
});

describe('Codex provider', () => {
  it('routes to codex, so one bridge can serve both CLIs', async () => {
    const stub = installPort();
    const provider = createCodexProvider();

    const pending = provider.complete({
      model: 'codex-cli',
      maxTokens: 100,
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Reply with ok.' },
      ],
    });

    stub.reply({ ok: true, text: 'ok', stopReason: 'stop' });
    expect((await pending).text).toBe('ok');

    const sent = stub.sent()!;
    expect(sent.cli).toBe('codex');
    // The host folds system into the prompt, because Codex has no
    // --system-prompt; the extension still sends them apart.
    expect(sent.system).toBe('Be terse.');
    expect(sent.prompt).toBe('Reply with ok.');
  });

  it('leaves Claude Code requests without a cli, so an older host still works', async () => {
    const stub = installPort();
    const pending = createClaudeCodeProvider().complete({
      model: 'claude-code',
      maxTokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    stub.reply({ ok: true, text: 'ok' });
    await pending;

    expect(stub.sent()!.cli).toBe('claude');
  });

  it('carries the signed-out code through instead of flattening it', async () => {
    // Being signed out and being out of quota need different advice, so the
    // host distinguishes them and the provider must not collapse that.
    const stub = installPort();
    const pending = createCodexProvider().complete({
      model: 'codex-cli',
      maxTokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });

    stub.reply({
      ok: false,
      error: {
        code: 'PERMISSION_DENIED',
        message: 'Codex is not signed in.',
        detail: 'Run `codex logout` then `codex login`.',
      },
    });

    await expect(pending).rejects.toMatchObject({
      code: ErrorCode.PERMISSION_DENIED,
      message: 'Codex is not signed in.',
    });
  });

  it('reports each CLI separately, so one missing does not hide the other', async () => {
    stubPermission(true);
    const stub = installPort();

    const pending = getBridgeStatus();
    // The permission check resolves first, so the port is connected a tick later.
    await vi.waitFor(() => expect(stub.port.postMessage).toHaveBeenCalled());
    stub.reply({ ok: true, version: '0.1.0', claudeFound: false, codexFound: true, codexPath: '/x/codex' });

    expect(await pending).toMatchObject({
      installed: true,
      claudeFound: false,
      codexFound: true,
      codexPath: '/x/codex',
    });
  });
});
