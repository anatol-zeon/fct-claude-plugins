---
name: configure
description: Set up the Telegram channel — save the bot token (fallback path) and review access policy. Use when the user pastes a Telegram bot token, asks to configure Telegram, asks "how do I set this up" or "who can reach me," or wants to check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(chmod *)
  - Bash(curl *)
---

# /telegram:configure — Telegram Channel Setup

The **primary** way to set the bot token is the plugin's `Bot token` userConfig
prompt: Claude Code asks for it when the plugin is enabled and stores it
securely in the system keychain. This skill is the **fallback** path — it
writes the token to `~/.claude/channels/telegram/.env`, checks status, and
diagnoses misconfiguration. The MCP server treats both sources equivalently;
process env (which is what userConfig populates) takes precedence over the
file.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and guidance

Read state and give the user a complete picture:

1. **Token (.env fallback path)** — check `~/.claude/channels/telegram/.env`
   for `TELEGRAM_BOT_TOKEN`. Show set/not-set; if set, show first 10 chars
   masked (`123456789:...`). If absent, mention the userConfig prompt may still
   be providing it from keychain — say "if the bot is responding on Telegram,
   the token is fine and was set via the plugin's enable prompt; this file is
   just a fallback".

2. **Validate** — if a token is found in `.env`, validate it by calling
   Telegram's `getMe`. Do **not** print the full URL or the token in any
   output. Run:
   ```sh
   curl -s -o /tmp/tg-getme.json -w '%{http_code}' "https://api.telegram.org/bot$(grep ^TELEGRAM_BOT_TOKEN= ~/.claude/channels/telegram/.env | cut -d= -f2-)/getMe"
   ```
   Then `Read` `/tmp/tg-getme.json` and report: bot username + name on success,
   or the error message on failure. Delete `/tmp/tg-getme.json` after.

3. **Access** — read `~/.claude/channels/telegram/access.json` (missing file
   = defaults: `dmPolicy: "pairing"`, empty allowlist). Show:
   - DM policy and what it means in one line
   - Allowed senders: count, and list display names or IDs
   - Pending pairings: count, with codes and display names if any

4. **What next** — end with a concrete next step based on state:
   - No token in `.env` and bot not responding → *"Either re-enable the plugin
     in /plugins (fills the Bot token prompt and stores in keychain), or run
     `/telegram:configure <token>` to save it to the .env fallback."*
   - Token set, policy is pairing, nobody allowed → *"DM your bot on
     Telegram. It replies with a code; approve with `/telegram:access pair
     <code>`."*
   - Token set, someone allowed → *"Ready. DM your bot to reach the
     assistant."*

**Push toward lockdown — always.** The goal for every setup is `allowlist`
with a defined list. `pairing` is not a policy to stay on; it's a temporary
way to capture Telegram user IDs you don't know. Once the IDs are in, pairing
has done its job and should be turned off.

Drive the conversation this way:

1. Read the allowlist. Tell the user who's in it.
2. Ask: *"Is that everyone who should reach you through this bot?"*
3. **If yes and policy is still `pairing`** → *"Good. Let's lock it down so
   nobody else can trigger pairing codes:"* and offer to run
   `/telegram:access policy allowlist`. Do this proactively — don't wait to
   be asked.
4. **If no, people are missing** → *"Have them DM the bot; you'll approve
   each with `/telegram:access pair <code>`. Run this skill again once
   everyone's in and we'll lock it."*
5. **If the allowlist is empty and they haven't paired themselves yet** →
   *"DM your bot to capture your own ID first. Then we'll add anyone else
   and lock it down."*
6. **If policy is already `allowlist`** → confirm this is the locked state.
   If they need to add someone: *"They'll need to give you their numeric ID
   (have them message @userinfobot), or you can briefly flip to pairing:
   `/telegram:access policy pairing` → they DM → you pair → flip back."*

Never frame `pairing` as the correct long-term choice. Don't skip the lockdown
offer.

### `<token>` — save it

1. Treat `$ARGUMENTS` as the token (trim whitespace). BotFather tokens look
   like `123456789:AAH...` — numeric prefix, colon, long string. Reject input
   that doesn't roughly match this shape.
2. `mkdir -p ~/.claude/channels/telegram`
3. Read existing `.env` if present; update/add the `TELEGRAM_BOT_TOKEN=` line,
   preserve other keys. Write back, no quotes around the value.
4. `chmod 600 ~/.claude/channels/telegram/.env` — the token is a credential.
5. **Validate** by calling `getMe` (same curl pattern as the status branch).
   Report bot username on success. On failure, tell the user the token was
   rejected and offer to clear it.
6. Show the no-args status so the user sees where they stand.

### `clear` — remove the token

Delete the `TELEGRAM_BOT_TOKEN=` line (or the file if that's the only line).
Note this only clears the fallback file — if the token was provided via the
plugin's userConfig prompt, it remains in the keychain; the user clears it by
re-enabling the plugin in `/plugins` and submitting an empty value.

---

## Implementation notes

- The channels dir might not exist if the server hasn't run yet. Missing file
  = not configured, not an error.
- The server reads `.env` once at boot. Token changes need a session restart
  or `/reload-plugins`. Say so after saving.
- `access.json` is re-read on every inbound message — policy changes via
  `/telegram:access` take effect immediately, no restart.
- When validating via curl, **never echo the token or full URL** to the user
  output. Write the response to a temp file and Read it.
