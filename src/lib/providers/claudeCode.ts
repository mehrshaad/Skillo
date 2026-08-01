import { browser } from 'wxt/browser';
import { ErrorCode, appError, type AppError, type ErrorCode as Code } from '@/lib/errors';
import type { ChatMessage, CompletionRequest, CompletionResponse, LLMProvider } from './types';

const HOST_NAME = 'com.skillo.bridge';
const CALL_TIMEOUT_MS = 200_000;

export interface BridgeStatus {
  installed: boolean;
  version?: string;
  claudeFound?: boolean;
  claudePath?: string | null;
}

interface BridgeResponse {
  ok: boolean;
  text?: string;
  stopReason?: string;
  version?: string;
  claudeFound?: boolean;
  claudePath?: string | null;
  error?: { code?: string; message?: string; detail?: string };
}

let nextId = 0;

const KNOWN_CODES: Code[] = [
  ErrorCode.BRIDGE_TIMEOUT,
  ErrorCode.BRIDGE_BUSY,
  ErrorCode.BRIDGE_CLI_NOT_FOUND,
  ErrorCode.BRIDGE_FAILED,
];

function fromBridgeError(error: BridgeResponse['error']): AppError {
  const code = KNOWN_CODES.find((c) => c === error?.code) ?? ErrorCode.BRIDGE_FAILED;
  return appError(code, error?.message ?? 'The Claude Code bridge failed.', error?.detail);
}

function notInstalled(detail?: string): AppError {
  return appError(
    ErrorCode.BRIDGE_NOT_INSTALLED,
    'Skillo could not reach the Claude Code bridge on this machine.',
    detail ?? 'Run the installer in the extension’s bridge/ folder, then try again.',
  );
}

/**
 * One connection per call. Native messaging keeps the host process alive for as
 * long as the port is open, and a completion is a single round trip, so there
 * is nothing to gain from holding it.
 */
function callBridge(request: Record<string, unknown>): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    let port: ReturnType<typeof browser.runtime.connectNative>;
    try {
      port = browser.runtime.connectNative(HOST_NAME);
    } catch (e) {
      reject(notInstalled(e instanceof Error ? e.message : String(e)));
      return;
    }

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      try {
        port.disconnect();
      } catch {
        // already gone
      }
    };

    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            appError(
              ErrorCode.BRIDGE_TIMEOUT,
              'The Claude Code bridge did not respond in time.',
            ),
          ),
        ),
      CALL_TIMEOUT_MS,
    );

    port.onMessage.addListener((msg: unknown) => {
      const response = msg as BridgeResponse;
      finish(() => {
        if (response?.ok) resolve(response);
        else reject(fromBridgeError(response?.error));
      });
    });

    // Fires when the host is missing, is not registered for this extension id,
    // or exits — all of which look the same from here.
    port.onDisconnect.addListener(() => {
      finish(() => reject(notInstalled(browser.runtime.lastError?.message)));
    });

    port.postMessage({ id: `skillo-${nextId++}`, ...request });
  });
}

export async function getBridgeStatus(): Promise<BridgeStatus> {
  const granted = await browser.permissions.contains({ permissions: ['nativeMessaging'] });
  if (!granted) return { installed: false };

  try {
    const res = await callBridge({ type: 'ping' });
    return {
      installed: true,
      version: res.version,
      claudeFound: res.claudeFound,
      claudePath: res.claudePath,
    };
  } catch {
    return { installed: false };
  }
}

/** Claude Code takes one prompt, so the conversation is flattened into it. */
function flatten(messages: ChatMessage[]): { system: string; prompt: string } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');

  const prompt = messages
    .filter((m) => m.role !== 'system')
    .map((m) =>
      m.role === 'assistant' ? `Your previous reply was:\n\n${m.content}` : m.content,
    )
    .join('\n\n---\n\n');

  return { system, prompt };
}

export function createClaudeCodeProvider(): LLMProvider {
  return {
    id: 'claude-code',

    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      // maxTokens is intentionally unused: Claude Code owns the model and its
      // output limit in headless mode.
      const { system, prompt } = flatten(req.messages);
      const res = await callBridge({ type: 'complete', system, prompt });

      if (typeof res.text !== 'string' || !res.text.trim()) {
        throw appError(ErrorCode.BRIDGE_FAILED, 'Claude Code returned an empty response.');
      }
      return { text: res.text, stopReason: res.stopReason };
    },

    async test(): Promise<void> {
      const status = await getBridgeStatus();
      if (!status.installed) throw notInstalled();
      if (!status.claudeFound) {
        throw appError(
          ErrorCode.BRIDGE_CLI_NOT_FOUND,
          'The bridge is installed but cannot find the claude command.',
          'Install Claude Code, or make sure `claude` is on your PATH, then try again.',
        );
      }
      await this.complete({
        model: 'claude-code',
        maxTokens: 64,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      });
    },
  };
}
