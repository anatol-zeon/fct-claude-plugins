# 2. Bridge process + idle mode for the Telegram channel

Date: 2026-05-12

## Status

Accepted

## Context

Telegram's Bot API allows **exactly one `getUpdates` consumer per bot token**. A second long-poller gets `409 Conflict`. But a Claude Code plugin's MCP server is spawned per session (`.mcp.json` is honored by every CC session that has the plugin enabled — the bridge, VS Code chats, ad-hoc terminal runs). If each of those started polling, they'd fight over the token: whichever lost the race would `409`-loop, and inbound messages would land in an unpredictable session.

We need: (a) exactly one process that owns the bot and receives inbound messages, (b) the plugin to still "load" in every other session (so CC's plugin loader doesn't error and the outbound tools are nominally present), (c) no manual coordination.

Additional failure mode: a crashed bridge (SIGKILL, terminal closed) can leave an orphan `bun server.ts` grandchild still holding the token, so the *next* bridge also `409`s.

## Decision

**One dedicated "bridge" session owns the bot; every other session runs the MCP server in idle mode.**

- The bridge is started via `scripts/claude-tg-bridge.sh`, which exports `TELEGRAM_BRIDGE=1` and runs `claude` in a restart loop.
- `server.ts`, at startup: if `TELEGRAM_BRIDGE !== '1'`, it connects an MCP transport with **no tools and no token load** and parks forever (idle mode) — CC sees a live plugin, nothing touches Telegram. Only the `TELEGRAM_BRIDGE=1` process loads the token, writes `bot.pid`, and starts grammy polling.
- Stale-poller cleanup: on start the bridge reads `bot.pid`; if it names a live foreign PID, it `SIGTERM`s it before polling.
- Liveness: stdin-EOF / SIGTERM/SIGINT/SIGHUP handlers + an orphan watchdog (poll for reparenting / dead stdin) → `bot.stop()` + exit, so the token slot is released promptly.
- Polling itself retries with backoff on any transient error (not just 409); 409 specifically gives up after 8 attempts (another holder exists — exiting is correct).
- `/newsession` (Telegram command) `SIGTERM`s the bridge's parent `claude`; the wrapper loop starts a fresh session with empty context.

Running the bridge under tmux or a systemd user unit is the supported way to keep it alive across ssh disconnects (`scripts/claude-tg-bridge.service` is a template).

## Consequences

- Single source of truth for "where do Telegram messages go" — the bridge session, period.
- Multiple bots on one host (or Telegram in several projects at once) require **separate tokens** + a per-instance `TELEGRAM_STATE_DIR`. There is no multi-token mode.
- Every non-bridge CC session still spawns a `bun` process that parks in idle mode — cheap, but non-zero. It also `chmod 600`s the `.env` as a side effect of the token-dir bootstrap even though it never reads the token.
- The bridge needs a wrapper script for the restart loop; "one-off `claude --channels …`" runs work but won't respawn on exit. Documented.
- `bot.pid`-based stale cleanup can in principle `SIGTERM` an unrelated process if a PID was recycled — narrow window, accepted.

## Alternatives considered

- **Webhook instead of long-polling** — would sidestep the single-consumer rule, but requires a public HTTPS endpoint; a non-starter for a local dev host. Rejected.
- **First-process-wins lock file (no dedicated bridge)** — whichever CC session starts first owns the bot. Rejected: inbound messages would land in a session you didn't choose (likely a transient VS Code chat); no stable "where does Telegram talk to" answer.
- **Refuse to load in non-bridge sessions** (exit non-zero) — CC surfaces that as a plugin error in every other session. Rejected in favor of silent idle mode.
