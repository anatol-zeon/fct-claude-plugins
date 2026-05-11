#!/usr/bin/env bash
# claude-tg-bridge.sh — long-running wrapper for the Telegram bridge session.
#
# Runs `claude --channels plugin:telegram@<marketplace> --dangerously-skip-permissions`
# in a loop so the inner Claude session is always alive on this host. The
# /newsession command in Telegram (server.ts) SIGTERMs its parent — the
# `claude` process — which exits cleanly; this loop then iterates and starts
# a fresh session with an empty context.
#
# Sets TELEGRAM_BRIDGE=1 so the MCP server in this dedicated session is the
# one that actually owns the bot token. MCP servers spawned by other sessions
# (e.g. VS Code chats) see the env var unset and stay in idle mode.
#
# Run under tmux/screen for interactive monitoring, or as a systemd user
# unit for unattended operation. See README "Run as a background service".
#
# Overrides via env:
#   TG_BRIDGE_MARKETPLACE   marketplace slug (default: fct-claude-plugins)
#   TG_BRIDGE_PLUGIN        plugin name (default: telegram)
#   CLAUDE_BIN              path to `claude` (default: command -v claude)

: "${TG_BRIDGE_MARKETPLACE:=fct-claude-plugins}"
: "${TG_BRIDGE_PLUGIN:=telegram}"
: "${CLAUDE_BIN:=}"

if [ -z "$CLAUDE_BIN" ]; then
  CLAUDE_BIN="$(command -v claude || true)"
fi
if [ -z "$CLAUDE_BIN" ] || [ ! -x "$CLAUDE_BIN" ]; then
  echo "[tg-bridge] 'claude' binary not found in PATH. Set CLAUDE_BIN env to override." >&2
  exit 1
fi
export CLAUDE_BIN

# The dev-channels wrapper attaches claude to a pty and auto-confirms the
# one-time "Loading development channels" warning. We can't use --channels
# directly because this fork isn't on Anthropic's curated channel-plugin
# allowlist; --dangerously-load-development-channels bypasses the allowlist
# but adds an interactive prompt per session, which would block unattended
# operation in tmux/systemd. The python helper handles that.
HELPER="$(dirname "$0")/claude-with-dev-channels.py"
if [ ! -x "$HELPER" ]; then
  echo "[tg-bridge] helper not executable: $HELPER" >&2
  exit 1
fi
if ! python3 -c "import pexpect" >/dev/null 2>&1; then
  echo "[tg-bridge] python3 pexpect module required: pip install --user pexpect" >&2
  exit 1
fi

export TELEGRAM_BRIDGE=1

trap 'echo "[tg-bridge] stopped" >&2; exit 0' INT TERM

echo "[tg-bridge] --dangerously-load-development-channels plugin:${TG_BRIDGE_PLUGIN}@${TG_BRIDGE_MARKETPLACE}" >&2
echo "[tg-bridge] claude: $CLAUDE_BIN" >&2

while true; do
  "$HELPER" \
    --dangerously-load-development-channels "plugin:${TG_BRIDGE_PLUGIN}@${TG_BRIDGE_MARKETPLACE}" \
    --dangerously-skip-permissions \
    "$@"
  rc=$?
  echo "[tg-bridge] session exited (rc=${rc}); restarting in 1s..." >&2
  sleep 1
done
