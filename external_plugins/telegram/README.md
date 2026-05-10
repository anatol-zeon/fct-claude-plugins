# Telegram

Connect a Telegram bot to your Claude Code with an MCP server.

The MCP server logs into Telegram as a bot and provides tools to Claude to reply, react, or edit messages. When you message the bot, the server forwards the message to your Claude Code session.

## Prerequisites

- [Bun](https://bun.sh) — the MCP server runs on Bun. Install with `curl -fsSL https://bun.sh/install | bash`.

## Quick Setup
> Default pairing flow for a single-user DM bot. See [ACCESS.md](./ACCESS.md) for groups and multi-user setups.

**1. Create a bot with BotFather.**

Open a chat with [@BotFather](https://t.me/BotFather) on Telegram and send `/newbot`. BotFather asks for two things:

- **Name** — the display name shown in chat headers (anything, can contain spaces)
- **Username** — a unique handle ending in `bot` (e.g. `my_assistant_bot`). This becomes your bot's link: `t.me/my_assistant_bot`.

BotFather replies with a token that looks like `123456789:AAHfiqksKZ8...` — that's the whole token, copy it including the leading number and colon.

**2. Add the marketplace and install the plugin.**

In a Claude Code session:

```
/plugin marketplace add anatol-zeon/fct-claude-plugins
/plugin install telegram@fct-claude-plugins
```

When the plugin is enabled, Claude Code prompts for **Bot token** — paste the BotFather token. It's stored in your system keychain. You can leave the prompt blank now and set it later with `/telegram:configure <token>`.

> Multiple bots on one machine: point `TELEGRAM_STATE_DIR` at a different directory per instance.

**3. Whitelist the channel (one-time settings edit).**

Channels from non-official marketplaces require explicit allow. Add this to `~/.claude/settings.json` once:

```json
{
  "allowedChannelPlugins": [
    { "marketplace": "fct-claude-plugins", "plugin": "telegram" }
  ]
}
```

Without it you'd have to pass `--dangerously-load-development-channels` on every launch.

**4. Start the dedicated bridge session.**

The bridge is a long-lived Claude session that owns the bot. Other Claude sessions on this host (VS Code chats, ad-hoc terminal runs) intentionally don't touch the bot — they'd just fight over Telegram's single-poller-per-token rule. Use the bundled wrapper:

```sh
external_plugins/telegram/scripts/claude-tg-bridge.sh
```

It sets `TELEGRAM_BRIDGE=1`, passes `--channels plugin:telegram@fct-claude-plugins --dangerously-skip-permissions`, and auto-restarts the inner session after `/newsession`. For running it under tmux or as a systemd user service so it survives ssh disconnect, see [Run as a background service](#run-as-a-background-service) below.

**5. Pair.**

With the bridge running from the previous step, DM your bot on Telegram — it replies with a 6-character pairing code. If the bot doesn't respond, make sure the bridge is up (`tmux attach -t tg-bridge` or `systemctl --user status claude-tg-bridge`). In your Claude Code session (any session, doesn't have to be the bridge):

```
/telegram:access pair <code>
```

Your next DM reaches the assistant.

> Unlike Discord, there's no server invite step — Telegram bots accept DMs immediately. Pairing handles the user-ID lookup so you never touch numeric IDs.

**6. Lock it down.**

Pairing is for capturing IDs. Once you're in, switch to `allowlist` so strangers don't get pairing-code replies. Ask Claude to do it, or `/telegram:access policy allowlist` directly.

## Run as a background service

The bridge is a dedicated Claude session that should keep running independently of any VS Code chat. Other sessions on the host see the plugin's MCP server boot too, but they enter idle mode (stderr line: `telegram channel: idle mode`) and never touch the bot — only the process with `TELEGRAM_BRIDGE=1` polls. The wrapper script sets this for you.

### tmux (interactive)

```sh
tmux new -d -s tg-bridge external_plugins/telegram/scripts/claude-tg-bridge.sh
tmux attach -t tg-bridge   # peek at logs
# Ctrl-b d to detach without stopping it
```

The tmux server survives ssh disconnect on its own. To stop: `tmux send-keys -t tg-bridge C-c` then `tmux kill-session -t tg-bridge`.

### systemd user unit (unattended)

Recommended for a long-lived dev host. The template lives at [scripts/claude-tg-bridge.service](./scripts/claude-tg-bridge.service):

```sh
mkdir -p ~/.config/systemd/user
cp external_plugins/telegram/scripts/claude-tg-bridge.service ~/.config/systemd/user/
# edit ExecStart= in the copy to the absolute path of claude-tg-bridge.sh
systemctl --user daemon-reload
systemctl --user enable --now claude-tg-bridge
loginctl enable-linger "$USER"     # survive ssh logout
```

Logs: `journalctl --user -u claude-tg-bridge -f`. Stop: `systemctl --user stop claude-tg-bridge`. Status: `systemctl --user status claude-tg-bridge`.

### Check fill: `/context`

DM the bot `/context` to get the current Claude session's token usage — total context tokens, model, last-turn breakdown, and `~%` against both the 200k and 1M context windows (the variant in use isn't recoverable from the model string alone, so we show both). The MCP server reads the session's transcript jsonl directly under `~/.claude/projects/`, so this works without any Claude-side cooperation.

### Reset context: `/newsession`

DM the bot `/newsession`. The bridge exits its current Claude session; the wrapper-loop restarts a fresh one with empty context. Useful when context fills up or you want to switch tasks without sshing back.

### One-off manual run

For ad-hoc tests without the loop:

```sh
TELEGRAM_BRIDGE=1 claude --channels plugin:telegram@fct-claude-plugins \
                          --dangerously-skip-permissions
```

Without `TELEGRAM_BRIDGE=1` the MCP server stays idle and never talks to Telegram.

## Access control

See **[ACCESS.md](./ACCESS.md)** for DM policies, groups, mention detection, delivery config, skill commands, and the `access.json` schema.

Quick reference: IDs are **numeric user IDs** (get yours from [@userinfobot](https://t.me/userinfobot)). Default policy is `pairing`. `ackReaction` only accepts Telegram's fixed emoji whitelist.

## Tools exposed to the assistant

| Tool | Purpose |
| --- | --- |
| `reply` | Send to a chat. Takes `chat_id` + `text`, optionally `reply_to` (message ID) for native threading and `files` (absolute paths) for attachments. Images (`.jpg`/`.png`/`.gif`/`.webp`) send as photos with inline preview; other types send as documents. Max 50MB each. Auto-chunks text; files send as separate messages after the text. Returns the sent message ID(s). |
| `react` | Add an emoji reaction to a message by ID. **Only Telegram's fixed whitelist** is accepted (👍 👎 ❤ 🔥 👀 etc). |
| `edit_message` | Edit a message the bot previously sent. Useful for "working…" → result progress updates. Only works on the bot's own messages. |

Inbound messages trigger a typing indicator automatically — Telegram shows
"botname is typing…" while the assistant works on a response.

## Photos

Inbound photos are downloaded to `~/.claude/channels/telegram/inbox/` and the
local path is included in the `<channel>` notification so the assistant can
`Read` it. Telegram compresses photos — if you need the original file, send it
as a document instead (long-press → Send as File).

## No history or search

Telegram's Bot API exposes **neither** message history nor search. The bot
only sees messages as they arrive — no `fetch_messages` tool exists. If the
assistant needs earlier context, it will ask you to paste or summarize.

This also means there's no `download_attachment` tool for historical messages
— photos are downloaded eagerly on arrival since there's no way to fetch them
later.
