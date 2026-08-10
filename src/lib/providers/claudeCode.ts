import { browser } from 'wxt/browser';
import { ErrorCode, appError, type AppError, type ErrorCode as Code } from '@/core/errors';
import type { ChatMessage, CompletionRequest, CompletionResponse, LLMProvider } from '@/core/providers/types';

const HOST_NAME = 'com.skillo.bridge';
const CALL_TIMEOUT_MS = 200_000;

/** Which local CLI a request is for. The bridge serves both from one host. */
export type LocalCli = 'claude' | 'codex';

export interface BridgeStatus {
  installed: boolean;
  version?: string;
  claudeFound?: boolean;
  claudePath?: string | null;
  codexFound?: boolean;
  codexPath?: string | null;
}

interface BridgeResponse {
  ok: boolean;
  text?: string;
  stopReason?: string;
  version?: string;
  claudeFound?: boolean;
  claudePath?: string | null;
  codexFound?: boolean;
  codexPath?: string | null;
  error?: { code?: string; message?: string; detail?: string };
}

let nextId = 0;

const KNOWN_CODES: Code[] = [
  ErrorCode.BRIDGE_TIMEOUT,
  ErrorCode.BRIDGE_BUSY,
  ErrorCode.BRIDGE_CLI_NOT_FOUND,
  ErrorCode.BRIDGE_FAILED,
  // Codex distinguishes "not signed in" from "out of quota"; both arrive here.
  ErrorCode.PERMISSION_DENIED,
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
      codexFound: res.codexFound,
      codexPath: res.codexPath,
    };
  } catch {
    return { installed: false };
  }
}

/** Both CLIs take one prompt, so the conversation is flattened into it. */
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

const CLI_META = {
  claude: {
    providerId: 'claude-code',
    label: 'Claude Code',
    command: 'claude',
    install: 'Install Claude Code, or make sure `claude` is on your PATH, then try again.',
  },
  codex: {
    providerId: 'codex-cli',
    label: 'Codex',
    command: 'codex',
    install: 'Install the Codex CLI, or make sure `codex` is on your PATH, then try again.',
  },
} as const;

/**
 * One implementation for both local CLIs. They differ only in what the bridge
 * runs — the extension side is identical, because the host normalizes both down
 * to `{ text }` and both own their own model and output limit in headless mode.
 */
export function createLocalCliProvider(cli: LocalCli): LLMProvider {
  const meta = CLI_META[cli];

  return {
    id: meta.providerId,

    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      // maxTokens is intentionally unused: the CLI owns the model and its
      // output limit in headless mode.
      const { system, prompt } = flatten(req.messages);
      const res = await callBridge({ type: 'complete', cli, system, prompt });

      if (typeof res.text !== 'string' || !res.text.trim()) {
        throw appError(ErrorCode.BRIDGE_FAILED, `${meta.label} returned an empty response.`);
      }
      return { text: res.text, stopReason: res.stopReason };
    },

    async test(): Promise<void> {
      const status = await getBridgeStatus();
      if (!status.installed) throw notInstalled();

      const found = cli === 'codex' ? status.codexFound : status.claudeFound;
      if (!found) {
        throw appError(
          ErrorCode.BRIDGE_CLI_NOT_FOUND,
          `The bridge is installed but cannot find the ${meta.command} command.`,
          meta.install,
        );
      }

      // A real completion, not just a discovery check: being signed out or out
      // of quota only shows up when something is actually asked of it.
      await this.complete({
        model: meta.providerId,
        maxTokens: 64,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      });
    },
  };
}

export const createClaudeCodeProvider = () => createLocalCliProvider('claude');
export const createCodexProvider = () => createLocalCliProvider('codex');
