# Skillo bridge to Claude Code

Lets Skillo use the Claude Code already installed on your machine instead of an
API key. Your existing Claude login does the work, and the job posting and
resume never go to a third-party provider.

## Why this needs an installer at all

A Chrome extension cannot write files, edit the registry, or start programs —
that is the sandbox, not a missing feature. Registering a
[native messaging host](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
needs all three, so something has to run outside the sandbox once. The smallest
honest version of that is one file you download and double-click.

Everything else in Skillo — the OpenRouter, OpenAI and Anthropic providers —
works with no install at all.

## Install

Open Skillo, go to **Settings → Claude Code**, and follow the three steps there:
download the installer, run it, press Connect. The status flips to *connected*
on its own once the bridge is registered.

The installers are generated into `public/bridge/` at build time and shipped
inside the extension:

| Platform | File | How to run it |
|---|---|---|
| Windows | `skillo-bridge-setup.bat` | Double-click it |
| macOS / Linux | `skillo-bridge-setup.sh` | `bash skillo-bridge-setup.sh` |

You need **Node.js 18+** and **Claude Code** on your PATH. The installer checks
both and tells you which is missing.

### Uninstall

Run the same file with `--uninstall`.

### If the installer says your extension isn't allowed

The host only talks to extension IDs it was built to allow. Skillo pins its
unpacked ID, and the Web Store ID is baked in once published — so this should
not come up. If it does, pass your ID (shown in Settings, and on
`chrome://extensions`) as an argument:

```
skillo-bridge-setup.bat abcdefghijklmnopabcdefghijklmnop
bash skillo-bridge-setup.sh abcdefghijklmnopabcdefghijklmnop
```

## What it installs

| | Windows | macOS / Linux |
|---|---|---|
| Host script | `%LOCALAPPDATA%\Skillo\host.mjs` | `~/.local/share/skillo/host.mjs` |
| Launcher | `%LOCALAPPDATA%\Skillo\skillo-bridge.bat` | *(not needed — the script is executable)* |
| Host manifest | `%LOCALAPPDATA%\Skillo\com.skillo.bridge.json` | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` (macOS) or `~/.config/google-chrome/NativeMessagingHosts/` (Linux) |
| Chrome pointer | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.skillo.bridge` | *(the manifest location is the pointer)* |

Nothing is installed system-wide and nothing needs administrator rights.
`host.mjs` travels inside the installer as base64, so there is no second
download and no network access during setup.

## How it runs Claude Code

Each request becomes one headless invocation:

```
claude -p --tools "" --output-format json --system-prompt <skillo's prompt>
```

with the actual prompt on stdin. `--tools ""` disables every tool, so the
bridge cannot read your files, run commands, or reach the network — it only
generates text. One request runs at a time, with a three-minute ceiling.

## When something is wrong

| Skillo says | What it means |
|---|---|
| *could not reach the Claude Code bridge* | Not installed, Chrome not restarted since installing, or the extension ID is not in the host's allowlist. |
| *the bridge is installed but cannot find the claude command* | The host runs but `claude` is not on the PATH Chrome hands it. Confirm `claude --version` works in a normal terminal. |
| *Claude Code did not finish within three minutes* | A long generation, or `claude` is waiting on something. Run the same prompt in a terminal to see what it wants. |
| *Claude Code is already working on another request* | A previous generation is still running. Wait for it. |

Chrome logs native messaging failures to the extension's service worker console
(`chrome://extensions` → Skillo → *service worker*).

## Developing on it

`bridge/host.mjs` is the source of truth. After editing it, regenerate the
installers so they carry the new host:

```bash
npm run bridge
```

`npm run build` does this for you.
