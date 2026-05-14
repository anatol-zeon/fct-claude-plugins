# Telegram channel — quickstart

Get a Telegram bot bridged into a Claude Code session, on your project, in
**~5 minutes from scratch**. For "why" and edge cases see [README.md](./README.md).

## 1. Make a bot

DM [@BotFather](https://t.me/BotFather) → `/newbot` → pick a display name and
a username (must end in `bot`). Copy the token: `123456789:AAH…`.

## 2. Host prerequisites

```sh
curl -fsSL https://bun.sh/install | bash       # bun
pip install --user pexpect                      # python3 + pexpect
sudo apt install -y tmux                        # tmux (or: brew install tmux)
# claude (Claude Code CLI) — see https://claude.ai/code
```

## 3. Clone the fork + install the plugin

```sh
git clone https://github.com/anatol-zeon/fct-claude-plugins.git ~/projects/fct-tg-bot
cd <your-codebase>      # ← bridges will run here as cwd
claude                  # opens a Claude Code session
```

In that Claude Code session:

```
/plugin marketplace add anatol-zeon/fct-claude-plugins
/plugin install telegram@fct-claude-plugins
```

## 4. Spin up a bridge for that bot

In a terminal (from the same `<your-codebase>` directory):

```sh
~/projects/fct-tg-bot/external_plugins/telegram/scripts/tg-instance.sh add 123456789:AAH…
```

That's it. The script validates the token, scaffolds an isolated state dir
under `~/.claude/channels/telegram-<botname>/`, drops a launcher with the
token embedded (chmod 700), and starts a tmux session `tg-bridge-<botname>`.
You'll see something like:

```
[tg-instance] token belongs to @your_bot (id 1234567890)
[tg-instance] created state dir: /home/you/.claude/channels/telegram-your_bot
[tg-instance] launcher cwd = /home/you/code/myproject
[tg-instance] ✓ @your_bot up — bun pid=12345, cwd=/home/you/code/myproject
```

## 5. Pair yourself

DM your bot anything. It replies with `Pairing required — run in Claude
Code: /telegram:access pair abc123`. In any Claude Code session, run:

```
/telegram:access pair abc123
/telegram:access policy allowlist
```

(The skill auto-detects which bot instance issued the code — you don't need a
flag.)  Telegram DMs `Paired! Say hi to Claude.` and follows up with
`🟢 Bridge online — @your_bot · main@<sha> · pid <N>`. The lockdown line stops
the bot from handing out pairing codes to strangers.

**Done.** Send the bot a message → it lands in the bridge's Claude session →
Claude replies via Telegram. `/context` to peek at token usage; `/newsession`
to rotate the Claude session without sshing back.

## More bots on the same project

Just `add` more tokens; each gets its own state-dir, tmux session, and
allowlist, but all share your project's source tree:

```sh
tg-instance.sh add <token2>
tg-instance.sh add <token3>
tg-instance.sh list                 # show every instance + pid + tmux state
tg-instance.sh start <slug>         # restart after a reboot
```

## After a host reboot

tmux sessions don't survive reboots by themselves. Either start them
manually with `tg-instance.sh start <slug>` for each instance, or set up
the systemd template at
[scripts/claude-tg-bridge.service](./scripts/claude-tg-bridge.service)
(see README §"Run as a background service").

## Troubleshooting one-liners

```sh
tg-instance.sh list                                  # who's alive
tmux attach -t tg-bridge-<slug>                      # watch the bridge live (Ctrl-b d to leave)
cat ~/.claude/channels/telegram-<slug>/access.json   # current allowlist / pending pairings
journalctl --user -u claude-tg-bridge -f             # if you used systemd
```

If the bridge replies to `/start` but not to plain DMs after pairing, you're
probably writing to the wrong bot — Telegram has lots of similarly-named
ones. Confirm the username in the chat header matches what `getMe` returned
(`tg-instance.sh list` shows the slug, which equals the username).
