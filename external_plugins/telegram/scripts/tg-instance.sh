#!/usr/bin/env bash
# tg-instance.sh — quick multi-bot management for the fct-claude-plugins
# telegram bridge.
#
# One token in, fully isolated bridge out. State directories sit side-by-side
# under ~/.claude/channels/ (default is .../telegram/; instances are
# .../telegram-<slug>/), tmux sessions are tg-bridge-<slug>. Each instance has
# its own bot token, allowlist, pending pairings, inbox, and PID file — they
# don't see each other. See ADR-0002 (bridge + idle mode) for why this works
# out of the box: single-poller-per-token is per *token*, not per process.
#
# Usage:
#   cd ~/projects/<your-codebase>     # ← bridges will run with this as cwd
#   tg-instance.sh add <bot-token>           validate, scaffold, start
#   tg-instance.sh add <bot-token> <slug>    same, with a custom slug
#   tg-instance.sh start <slug>              (re)start an existing instance
#   tg-instance.sh list                      show all instances and their state
#
# All instances launched from the same project dir share that as their cwd
# (so each bridge's claude session sees the same source tree and can edit
# the same files). State directories — allowlist, pending pairings, inbox,
# bot.pid — are per-instance under ~/.claude/channels/telegram-<slug>/, so
# inboxes and access control are fully isolated.
#
# Notes:
# - Telegram allows ONE getUpdates consumer per token; never add two instances
#   on the same token — they'll 409 each other. The script refuses to do this
#   when it can detect the conflict (same token already in another launcher).
# - The default instance (~/.claude/channels/telegram/) is listed too, but
#   not managed by `add`/`start` — it predates this tool. Use the existing
#   scripts/claude-tg-bridge.sh flow for it.
# - /context across parallel instances on the same cwd is imperfect: it picks
#   the freshest .jsonl in ~/.claude/projects/<cwd-hash>/, so on a busy host
#   it may report a sibling bot's token usage. The boot greeting prints the
#   bridge's own PID so you can tell which session is which at a glance.

set -euo pipefail

CHANNELS_ROOT="${TELEGRAM_CHANNELS_ROOT:-$HOME/.claude/channels}"
PLUGIN_ROOT="${TG_BRIDGE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
WRAPPER="$PLUGIN_ROOT/scripts/claude-tg-bridge.sh"
BOOT_WAIT_SEC="${TG_INSTANCE_BOOT_WAIT:-12}"

usage() {
  cat >&2 <<'EOF'
usage:
  tg-instance.sh add <bot-token> [<slug>]   # validate token via getMe, scaffold, start
  tg-instance.sh start <slug>               # (re)start an existing instance
  tg-instance.sh list                       # all instances + state
EOF
  exit 2
}

require_cmd() {
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || { echo "error: '$c' not found in PATH" >&2; exit 1; }
  done
}

# Pull a JSON field out of stdin via python (python3 is already required by
# the bridge wrapper — see ADR-0003 — so no new dependency).
json_get() {
  python3 -c "
import sys, json
try:
  d = json.loads(sys.stdin.read())
except Exception as e:
  print('parse-error: %s' % e, file=sys.stderr); sys.exit(1)
node = d
for part in '$1'.split('.'):
  if isinstance(node, dict) and part in node:
    node = node[part]
  else:
    sys.exit(2)
print(node)
"
}

token_basic_shape_ok() {
  case "$1" in
    [0-9]*:?*) return 0 ;;
    *) return 1 ;;
  esac
}

sanitize_slug() {
  # Telegram usernames are [a-zA-Z0-9_], so this is mostly defensive against
  # whatever the operator might pass as a custom slug.
  printf %s "$1" | tr -c 'a-zA-Z0-9_-' '-' | tr 'A-Z' 'a-z' | sed 's/^-*//; s/-*$//'
}

# Refuse to scaffold a second instance for a token that's already wired up.
# We check both the per-instance launcher (run.sh) for `${bot_id}:` and the
# default instance's .env. Won't catch every edge case (a tmux session pasting
# the token live), but covers the typical foot-gun.
check_token_conflict() {
  local bot_id="$1" my_state_dir="$2"
  for existing in "$CHANNELS_ROOT"/telegram*/run.sh "$CHANNELS_ROOT"/telegram/.env; do
    [[ -f "$existing" ]] || continue
    if grep -q "${bot_id}:" "$existing" 2>/dev/null; then
      local owner_dir
      owner_dir=$(dirname "$existing")
      if [[ "$owner_dir" != "$my_state_dir" ]]; then
        echo "error: bot id ${bot_id} already configured in ${owner_dir}" >&2
        echo "  multiple instances on the same token will 409 each other; aborting." >&2
        return 1
      fi
    fi
  done
  return 0
}

cmd_add() {
  local token="${1:?missing token}"
  local explicit_slug="${2:-}"
  require_cmd curl python3 tmux

  if ! token_basic_shape_ok "$token"; then
    echo "error: token doesn't look like BotFather format (digits:secret)" >&2
    exit 1
  fi

  echo "[tg-instance] validating token via getMe…" >&2
  local response
  response=$(curl -fsS --max-time 10 "https://api.telegram.org/bot${token}/getMe") || {
    echo "error: getMe failed — token rejected by Telegram or network unreachable" >&2; exit 1
  }
  local ok username bot_id
  ok=$(printf %s "$response" | json_get ok || true)
  if [[ "$ok" != "True" ]] && [[ "$ok" != "true" ]]; then
    echo "error: getMe responded ok=$ok — token invalid or revoked" >&2; exit 1
  fi
  username=$(printf %s "$response" | json_get result.username)
  bot_id=$(printf %s "$response" | json_get result.id)
  echo "[tg-instance] token belongs to @${username} (id ${bot_id})"

  local slug
  if [[ -n "$explicit_slug" ]]; then
    slug=$(sanitize_slug "$explicit_slug")
  else
    slug=$(sanitize_slug "$username")
  fi
  if [[ -z "$slug" ]] || [[ "$slug" == "default" ]]; then
    echo "error: invalid slug ('default' is reserved for the unmanaged default instance)" >&2; exit 1
  fi

  local state_dir="$CHANNELS_ROOT/telegram-${slug}"
  check_token_conflict "$bot_id" "$state_dir"

  if [[ -d "$state_dir" ]]; then
    echo "[tg-instance] state dir exists: $state_dir — reusing (access.json/allowlist preserved)"
  else
    mkdir -p "$state_dir/approved" "$state_dir/inbox"
    chmod 700 "$state_dir"
    cat > "$state_dir/access.json" <<'JSON'
{
  "dmPolicy": "pairing",
  "allowFrom": [],
  "groups": {},
  "pending": {}
}
JSON
    chmod 600 "$state_dir/access.json"
    echo "[tg-instance] created state dir: $state_dir"
  fi

  # Capture the project cwd: the directory the operator was in when they
  # called `add`. That's where the bridge's claude session will run, so its
  # MCP tools (Read/Edit/Bash/…) operate on this codebase. Allows multiple
  # instances on the same project, each with its own bot + allowlist.
  local project_cwd
  project_cwd="${TG_INSTANCE_CWD:-$PWD}"
  if [[ ! -d "$project_cwd" ]]; then
    echo "error: project cwd does not exist: $project_cwd" >&2; exit 1
  fi

  # Write the per-instance launcher. chmod 700 — only owner readable, since
  # it embeds the bot token. The token can be re-extracted by anyone with read
  # access; same security posture as the default instance's .env (also 600).
  local launcher="$state_dir/run.sh"
  umask 077
  cat > "$launcher" <<EOF
#!/bin/bash
# Auto-generated by tg-instance.sh add — keep chmod 700.
# Slug:    ${slug}
# Bot:     @${username} (id ${bot_id})
# Project: ${project_cwd}
export TELEGRAM_BOT_TOKEN='${token}'
export TELEGRAM_STATE_DIR='${state_dir}'
cd '${project_cwd}'
exec '${WRAPPER}'
EOF
  chmod 700 "$launcher"
  echo "[tg-instance] launcher cwd = ${project_cwd}"
  echo "[tg-instance] wrote launcher: $launcher"

  cmd_start "$slug"
}

cmd_start() {
  local slug="${1:?missing slug}"
  require_cmd tmux

  local state_dir="$CHANNELS_ROOT/telegram-${slug}"
  local launcher="$state_dir/run.sh"
  if [[ ! -x "$launcher" ]]; then
    echo "error: no launcher at $launcher — run 'add <token>' first" >&2; exit 1
  fi

  local session="tg-bridge-${slug}"
  if tmux has-session -t "$session" 2>/dev/null; then
    echo "[tg-instance] tmux session ${session} already running — restarting"
    tmux kill-session -t "$session"
    sleep 1
  fi
  rm -f "$state_dir/bot.pid"
  tmux new-session -d -s "$session" "$launcher"
  echo "[tg-instance] started ${session}; waiting ${BOOT_WAIT_SEC}s for poller…"
  sleep "$BOOT_WAIT_SEC"
  local pid=""
  [[ -f "$state_dir/bot.pid" ]] && pid=$(cat "$state_dir/bot.pid")
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    local cwd_link
    cwd_link=$(readlink "/proc/$pid/cwd" 2>/dev/null || echo "?")
    echo "[tg-instance] ✓ @${slug} up — bun pid=${pid}, cwd=${cwd_link}"
  else
    echo "[tg-instance] WARN: bot.pid not written within ${BOOT_WAIT_SEC}s." >&2
    echo "  attach with:  tmux attach -t ${session}" >&2
    exit 1
  fi
}

cmd_list() {
  shopt -s nullglob
  printf "%-30s %-10s %-12s %s\n" "INSTANCE" "POLLER" "TMUX" "STATE_DIR"
  local d slug name session pid p tm cwd_link bot_username
  for d in "$CHANNELS_ROOT"/telegram "$CHANNELS_ROOT"/telegram-*; do
    [[ -d "$d" ]] || continue
    name=$(basename "$d")
    case "$name" in
      telegram) slug="default" ; session="tg-bridge" ;;
      telegram-*) slug="${name#telegram-}" ; session="tg-bridge-${slug}" ;;
    esac
    pid="-"
    cwd_link=""
    if [[ -f "$d/bot.pid" ]]; then
      p=$(cat "$d/bot.pid" 2>/dev/null || true)
      if [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; then
        pid="$p"
        cwd_link=$(readlink "/proc/$p/cwd" 2>/dev/null || true)
      else
        pid="stale"
      fi
    fi
    tm="no"
    tmux has-session -t "$session" 2>/dev/null && tm="yes"
    printf "%-30s %-10s %-12s %s\n" "$slug" "$pid" "$tm" "$d"
  done
}

case "${1:-}" in
  add)   shift; cmd_add "$@" ;;
  start) shift; cmd_start "$@" ;;
  list)  shift; cmd_list "$@" ;;
  -h|--help|help|"") usage ;;
  *) echo "error: unknown command '$1'" >&2; usage ;;
esac
