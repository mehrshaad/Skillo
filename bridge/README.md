# Skillo bridge to Claude Code

Lets Skillo use the Claude Code already installed on your machine instead of an
API key. Your existing Claude login does the work, and the job posting and
resume never go to a third-party provider.

Chrome extensions cannot start programs, so this is the standard way around it:
a small Node script that Chrome launches on demand and talks to over stdin and
stdout ([native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)).

## What you need

- **Node.js 18 or newer** on your PATH — the host is a Node script.
- **Claude Code** installed and signed in. Check with `claude --version`.

## Install

**Windows** (PowerShell):

```powershell
cd bridge
.\install.ps1
```

**macOS / Linux**:

```bash
cd bridge
./install.sh
```

Then restart Chrome if it was already running, open Skillo, go to **Settings →
Claude Code → Connect**, and approve the permission prompt. The status should
read *connected*.

### If your extension id is different

The installer whitelists one extension id. Skillo pins its id to
`hfbincjmdcgfhffnpanjdfcccpejdkei`, so the default is normally right. If
`chrome://extensions` shows a different id, pass yours:

```powershell
.\install.ps1 -ExtensionId your-id-here
```

```bash
./install.sh your-id-here
```

## Uninstall

```powershell
.\install.ps1 -Uninstall
```

```bash
./install.sh --uninstall
```

## What the installer does

| | Windows | macOS / Linux |
|---|---|---|
| Host script | `%LOCALAPPDATA%\Skillo\host.mjs` | `~/.local/share/skillo/host.mjs` |
| Launcher | `%LOCALAPPDATA%\Skillo\skillo-bridge.bat` | *(not needed — the script is executable)* |
| Host manifest | `%LOCALAPPDATA%\Skillo\com.skillo.bridge.json` | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` (macOS) or `~/.config/google-chrome/NativeMessagingHosts/` (Linux) |
| Chrome pointer | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.skillo.bridge` | *(the manifest location is the pointer)* |

Nothing is installed system-wide and nothing needs administrator rights.

## How it runs Claude Code

Each request becomes one headless invocation:

```
claude -p --tools "" --output-format json --system-prompt <skillo's prompt>
```

with the actual prompt on stdin. `--tools ""` disables every tool, so the
bridge cannot read your files, run commands, or reach the network — it only
generates text. One request runs at a time, and each has a three-minute
ceiling.

## When something is wrong

| Skillo says | What it means |
|---|---|
| *could not reach the Claude Code bridge* | The host is not installed, Chrome has not been restarted since installing, or the whitelisted extension id does not match the one in `chrome://extensions`. |
| *the bridge is installed but cannot find the claude command* | The host is running but `claude` is not on the PATH Chrome hands it. Confirm `claude --version` works in a normal terminal. |
| *Claude Code did not finish within three minutes* | A long generation, or `claude` is waiting on something. Try again; if it repeats, run the same prompt in a terminal to see what it is asking for. |
| *Claude Code is already working on another request* | A previous generation is still running. Wait for it. |

To see the raw exchange, run the host by hand and watch stderr — Chrome logs
native messaging failures to the extension's service worker console
(`chrome://extensions` → Skillo → *service worker*).
