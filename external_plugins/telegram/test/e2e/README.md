# Bridge end-to-end tests

The unit tests under `src/*.test.ts` exercise the pure logic (`gate`, `chunk`,
`parseLastUsage`, `isMentioned`, …) in isolation. They can't see the ~940 lines
of IO/wiring in `server.ts` — grammy handlers, the MCP server, the bridge
lifecycle, the threading between inbound Telegram updates and outbound MCP
notifications. **These e2e tests do.**

## Setup

The suite spawns a real `bun server.ts` subprocess and stands up two stand-ins
around it:

- **`telegram-mock.ts`** — an in-process HTTP mock of `api.telegram.org`,
  served by `Bun.serve` on an OS-picked port. The bridge talks to it because we
  set `TELEGRAM_API_ROOT=http://localhost:<port>` in the subprocess env
  (`server.ts` reads this and passes it to grammy as `client.apiRoot`). The
  mock implements `getMe`, a long-poll `getUpdates`, `sendMessage`/`sendPhoto`/
  `sendDocument`, `editMessageText`, `setMessageReaction`, `setMyCommands`,
  `sendChatAction`. Anything else returns `{ ok: true, result: true }` so a new
  outbound call from `server.ts` doesn't break the mock; the test can still
  assert on the recorded request.

- **`bridge-harness.ts`** — spawns the subprocess with a fresh
  `TELEGRAM_STATE_DIR` (so we don't clobber `~/.claude/channels/telegram/`),
  optionally pre-populating `access.json` and `approved/<senderId>` files;
  attaches a minimal line-delimited-JSON MCP client to the subprocess's
  stdio (handshakes `initialize` / `notifications/initialized`, then forwards
  notifications); exposes `pushUpdate`, `waitForNotification`,
  `sendNotification`, and `mock.waitFor(predicate)` for outbound assertions.

Bridge readiness is signalled by `setMyCommands` arriving at the mock — that
call fires from grammy's `onStart` once polling is up.

## Scenarios (`bridge.e2e.test.ts`)

| # | What it covers |
|---|---|
| 1. unpaired DM → pairing code | Stranger DMs the bot under `dmPolicy: "pairing"` with an empty allowlist. Asserts the bridge replies via Telegram with `Pairing required — … /telegram:access pair <6-hex>` and emits **no** `notifications/claude/channel` (the message is paired-not-delivered). |
| 2. allowlisted DM → MCP delivery | DM from an `allowFrom` member. Asserts an outbound `sendChatAction` (typing indicator) and an MCP `notifications/claude/channel` carrying `content`, `meta.chat_id`, `meta.user_id`, `meta.message_id`, `meta.user`. |
| 3. permission-relay round-trip | Test sends `notifications/claude/channel/permission_request` to the bridge. Asserts an outbound DM to the owner with `🔐 Permission [<id>]: …` and a `Reply: y <id>` hint. Pushes a `y <id>` inbound from the owner. Asserts: (a) MCP `notifications/claude/channel/permission` with `{request_id, behavior:'allow'}`, (b) `setMessageReaction` ✅ on the reply, (c) **no** plain-text channel relay of `y <id>` (the gate intercepted it). |
| 4. `/status` DM | Allowlisted user sends `/status`. Asserts the bridge replies with `Paired as …` — exercises the DM-only `bot.command` path through `dmCommandGate`. |

Both ends are real: the MCP transport is the same stdio JSON-RPC server.ts
uses in production; the grammy polling loop is real; only `api.telegram.org`
is mocked. A green run means the bridge can route an inbound update from
"Telegram" through `gate()` to MCP, and route a permission request from MCP
through to "Telegram" and back, without us hand-waving any of the wiring.

## What's not yet covered

- Photo/document **download paths**. Server.ts and the wrapper both fetch
  `https://api.telegram.org/file/bot<token>/<path>` with raw `fetch`, bypassing
  grammy's `apiRoot`. Mocking that would need either a per-call URL override
  or `globalThis.fetch` interception.
- The 5s `checkApprovals` interval (the `approved/<senderId>` → "Paired!" DM).
  Pre-staging is supported in the harness (`approved` option), but waiting out
  the interval would slow each scenario by 5+ seconds. Skipped for now.
- The proactive context-fill warning (`TELEGRAM_CONTEXT_THRESHOLD` + the 60s
  jsonl polling loop) — same reason.
- Markdown rendering (`format: 'markdownv2'`) and chunked replies past the 4096
  char limit. The chunking logic is unit-tested; an e2e for it is low-value.

## Run

```bash
cd external_plugins/telegram
bun test test/e2e/          # ~2 s
bun test                    # full suite (unit + e2e)
bun run test:unit           # just src/*.test.ts (~100 ms)
bun run test:e2e            # just the e2e suite
```

Set `stderr: 'inherit'` in `bridge-harness.ts`'s `spawnBridge` to see the
bridge subprocess's stderr while iterating on a failing test.
