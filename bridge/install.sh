#!/usr/bin/env bash
# Registers the Skillo native messaging host so the Chrome extension can talk
# to your local Claude Code install.
#
#   ./install.sh                 install for the default (pinned) extension id
#   ./install.sh <extension-id>  install for a different id
#   ./install.sh --uninstall     remove everything this script installed

set -euo pipefail

HOST_NAME="com.skillo.bridge"
DEFAULT_EXTENSION_ID="hfbincjmdcgfhffnpanjdfcccpejdkei"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$HOME/.local/share/skillo"

case "$(uname -s)" in
  Darwin) MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" ;;
  Linux)  MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts" ;;
  *)      echo "Unsupported platform: $(uname -s). On Windows use install.ps1." >&2; exit 1 ;;
esac

MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$MANIFEST_PATH"
  rm -rf "$INSTALL_DIR"
  echo "Skillo bridge uninstalled."
  exit 0
fi

EXTENSION_ID="${1:-$DEFAULT_EXTENSION_ID}"

command -v node >/dev/null 2>&1 || {
  echo "Node.js was not found on your PATH. Install Node 18 or newer, then run this script again." >&2
  exit 1
}
echo "Using Node at $(command -v node)"

if command -v claude >/dev/null 2>&1; then
  echo "Found claude at $(command -v claude)"
else
  echo "Warning: the claude command was not found on your PATH." >&2
  echo "The bridge will install, but Skillo cannot use it until Claude Code is installed." >&2
fi

mkdir -p "$INSTALL_DIR" "$MANIFEST_DIR"
cp "$SCRIPT_DIR/host.mjs" "$INSTALL_DIR/host.mjs"
chmod +x "$INSTALL_DIR/host.mjs"
echo "Installed host.mjs to $INSTALL_DIR"

cat > "$MANIFEST_PATH" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Skillo bridge to the local Claude Code CLI",
  "path": "$INSTALL_DIR/host.mjs",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
JSON
echo "Wrote manifest $MANIFEST_PATH"

echo
echo "Skillo bridge installed."
echo "Allowed extension: $EXTENSION_ID"
echo "Next: open Skillo, go to Settings, pick Claude Code, and press Connect."
echo "If Chrome was already running, restart it first."
