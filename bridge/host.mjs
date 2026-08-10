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
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/* -------------------------------------------------------- codex discovery */

function resolveCodex() {
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat'] : ['codex'];

  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    // Where the official Windows installer puts it.
    join(homedir(), 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin'),
    join(homedir(), '.local', 'bin'),
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

/**
 * Both Codex failure modes look identical from the outside — exit 1, empty
 * stdout, no output file — so the wording is all there is to go on. Telling
 * someone to sign in again when they are actually out of quota sends them round
 * a loop that cannot help.
 */
function codexError(stderr, code) {
  const text = stderr.slice(-1500);

  if (/usage limit|Upgrade to Plus/i.test(text)) {
    const when = text.match(/try again at ([^.\n]+)/i);
    return {
      code: 'BRIDGE_FAILED',
      message: "Codex says you've hit your usage limit.",
      detail: when ? `Try again at ${when[1].trim()}, or upgrade your plan.` : 'Try again later, or upgrade your plan.',
    };
  }

  if (/refresh token|sign in again|not logged in|unauthorized/i.test(text)) {
    return {
      code: 'PERMISSION_DENIED',
      message: 'Codex is not signed in.',
      detail: 'Run `codex logout` then `codex login` in a terminal, and try again.',
    };
  }

  return {
    code: 'BRIDGE_FAILED',
    message: `Codex exited with code ${code}.`,
    detail: text.slice(-500),
  };
}

/**
 * Codex has no `--system-prompt`, so the system text is folded into the prompt.
 * `-o` is used rather than `--json` because the latter emits JSONL *events*
 * while `-o` writes exactly the final message. `-s read-only` is the closest
 * thing it has to Claude's `--tools ""` — it is an agent, not a text endpoint.
 */
function runCodex(codexPath, systemPrompt, prompt) {
  return new Promise((resolve) => {
    const outFile = join(tmpdir(), `skillo-codex-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    const args = [
      'exec', '-',
      '--skip-git-repo-check',
      '--ephemeral',
      '-s', 'read-only',
      '--color', 'never',
      '-o', outFile,
    ];

    const child = spawn(codexPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      cwd: tmpdir(),
      shell: /\.(cmd|bat)$/i.test(codexPath),
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const cleanup = () => {
      try {
        if (existsSync(outFile)) unlinkSync(outFile);
      } catch {
        // A leftover temp file is not worth failing a completion over.
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        ok: false,
        error: { code: 'BRIDGE_TIMEOUT', message: 'Codex did not finish within three minutes.' },
      });
    }, REQUEST_TIMEOUT_MS);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));

    child.on('error', (e) =>
      finish({
        ok: false,
        error: { code: 'BRIDGE_FAILED', message: 'Could not start Codex.', detail: e.message },
      }),
    );

    child.on('close', (code) => {
      if (code !== 0) return finish({ ok: false, error: codexError(stderr, code) });

      let text = '';
      try {
        if (existsSync(outFile)) text = readFileSync(outFile, 'utf8').trim();
      } catch {
        text = '';
      }

      // No output file on a zero exit should not happen, but an empty reply is
      // indistinguishable from a broken one to the caller either way.
      if (!text) {
        return finish({
          ok: false,
          error: {
            code: 'BRIDGE_FAILED',
            message: 'Codex finished without returning any text.',
            detail: (stderr || stdout).slice(-500),
          },
        });
      }

      finish({ ok: true, text });
    });

    const combined = systemPrompt ? `${systemPrompt}\n\n---\n\n${prompt}` : prompt;
    child.stdin.end(combined, 'utf8');
  });
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
    const codexPath = resolveCodex();
    return writeMessage({
      id,
      ok: true,
      version: HOST_VERSION,
      claudeFound: Boolean(claudePath),
      claudePath: claudePath ?? null,
      codexFound: Boolean(codexPath),
      codexPath: codexPath ?? null,
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
        message: 'The bridge is already working on another request.',
      },
    });
  }

  // Older extensions send no `cli` at all, so Claude Code stays the default.
  const cli = request.cli === 'codex' ? 'codex' : 'claude';
  const path = cli === 'codex' ? resolveCodex() : resolveClaude();

  if (!path) {
    return writeMessage({
      id,
      ok: false,
      error: {
        code: 'BRIDGE_CLI_NOT_FOUND',
        message:
          cli === 'codex'
            ? 'The codex command could not be found on this machine.'
            : 'The claude command could not be found on this machine.',
        detail:
          cli === 'codex'
            ? 'Install the Codex CLI, or make sure `codex` is on your PATH.'
            : 'Install Claude Code, or make sure `claude` is on your PATH.',
      },
    });
  }

  busy = true;
  try {
    const run = cli === 'codex' ? runCodex : runClaude;
    const result = await run(path, request.system ?? '', request.prompt ?? '');
    writeMessage({ id, ...result });
  } finally {
    busy = false;
  }
}
