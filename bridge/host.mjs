#!/usr/bin/env node
/**
 * Skillo native messaging host.
 *
 * Chrome extensions cannot start processes, so this small Node script sits
 * between the extension and the locally installed Claude Code CLI. It speaks
 * Chrome's native messaging framing on stdin/stdout and shells out to
 * `claude -p` for each completion.
 *
 * Deliberately dependency-free: it is installed outside the extension and
 * should not need an npm install to run.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const HOST_VERSION = '0.1.0';
const REQUEST_TIMEOUT_MS = 180_000;
/** Chrome drops host→extension messages larger than 1 MB. */
const MAX_MESSAGE_BYTES = 1_000_000;

/* --------------------------------------------------- native messaging I/O */

function writeMessage(message) {
  let json = Buffer.from(JSON.stringify(message), 'utf8');

  if (json.length > MAX_MESSAGE_BYTES) {
    json = Buffer.from(
      JSON.stringify({
        id: message.id,
        ok: false,
        error: {
          code: 'BRIDGE_FAILED',
          message: 'Claude Code returned more text than the bridge can pass back to Chrome.',
          detail: `${json.length} bytes exceeds the 1 MB native messaging limit.`,
        },
      }),
      'utf8',
    );
  }

  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(Buffer.concat([header, json]));
}

let inbox = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  inbox = Buffer.concat([inbox, chunk]);

  while (inbox.length >= 4) {
    const length = inbox.readUInt32LE(0);
    if (inbox.length < 4 + length) break;

    const body = inbox.subarray(4, 4 + length).toString('utf8');
    inbox = inbox.subarray(4 + length);

    let request;
    try {
      request = JSON.parse(body);
    } catch {
      continue; // not addressable — no id to reply to
    }
    handle(request);
  }
});

process.stdin.on('end', () => process.exit(0));

/* ------------------------------------------------------- claude discovery */

function resolveClaude() {
  const names =
    process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude.bat'] : ['claude'];

  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.claude', 'local'),
    join(homedir(), 'AppData', 'Roaming', 'npm'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/* ------------------------------------------------------------ completions */

/** One child at a time; the extension never issues concurrent completions. */
let busy = false;

function runClaude(claudePath, systemPrompt, prompt) {
  return new Promise((resolve) => {
    const args = ['-p', '--tools', '', '--output-format', 'json'];
    if (systemPrompt) args.push('--system-prompt', systemPrompt);

    const child = spawn(claudePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // .cmd/.bat shims are not executables and need the shell to launch.
      shell: /\.(cmd|bat)$/i.test(claudePath),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        error: {
          code: 'BRIDGE_TIMEOUT',
          message: 'Claude Code did not finish within three minutes.',
        },
      });
    }, REQUEST_TIMEOUT_MS);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));

    child.on('error', (e) =>
      finish({
        ok: false,
        error: {
          code: 'BRIDGE_FAILED',
          message: 'Could not start Claude Code.',
          detail: e.message,
        },
      }),
    );

    child.on('close', (code) => {
      if (code !== 0) {
        return finish({
          ok: false,
          error: {
            code: 'BRIDGE_FAILED',
            message: `Claude Code exited with code ${code}.`,
            detail: (stderr || stdout).slice(0, 500),
          },
        });
      }

      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        return finish({
          ok: false,
          error: {
            code: 'BRIDGE_FAILED',
            message: 'Could not read Claude Code’s response.',
            detail: stdout.slice(0, 500),
          },
        });
      }

      if (parsed.is_error || typeof parsed.result !== 'string') {
        return finish({
          ok: false,
          error: {
            code: 'BRIDGE_FAILED',
            message: 'Claude Code reported an error.',
            detail: String(parsed.result ?? parsed.subtype ?? '').slice(0, 500),
          },
        });
      }

      finish({ ok: true, text: parsed.result, stopReason: parsed.stop_reason });
    });

    child.stdin.end(prompt, 'utf8');
  });
}

/* ---------------------------------------------------------------- routing */

async function handle(request) {
  const id = request?.id;

  if (request?.type === 'ping') {
    const claudePath = resolveClaude();
    return writeMessage({
      id,
      ok: true,
      version: HOST_VERSION,
      claudeFound: Boolean(claudePath),
      claudePath: claudePath ?? null,
    });
  }

  if (request?.type !== 'complete') {
    return writeMessage({
      id,
      ok: false,
      error: { code: 'BRIDGE_FAILED', message: `Unknown request type "${request?.type}".` },
    });
  }

  if (busy) {
    return writeMessage({
      id,
      ok: false,
      error: {
        code: 'BRIDGE_BUSY',
        message: 'Claude Code is already working on another request.',
      },
    });
  }

  const claudePath = resolveClaude();
  if (!claudePath) {
    return writeMessage({
      id,
      ok: false,
      error: {
        code: 'BRIDGE_CLI_NOT_FOUND',
        message: 'The claude command could not be found on this machine.',
        detail: 'Install Claude Code, or make sure `claude` is on your PATH.',
      },
    });
  }

  busy = true;
  try {
    const result = await runClaude(claudePath, request.system ?? '', request.prompt ?? '');
    writeMessage({ id, ...result });
  } finally {
    busy = false;
  }
}
