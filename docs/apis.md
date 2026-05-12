# External and internal APIs

Реестр всех API, с которыми работает проект. Обновляется каждый раз при подключении/отключении/замене.

## External (third-party)

| Имя | URL / vendor | Цель | Используют сервисы | Auth | Статус | Замена кем |
|---|---|---|---|---|---|---|
| Telegram Bot API | `https://api.telegram.org/bot<token>/…` (Telegram LLC) | Long-polling входящих (`getUpdates` через grammy), отправка `sendMessage`/`sendPhoto`/`sendDocument`, `setMessageReaction`, `editMessageText`, `getFile` + скачивание `…/file/bot<token>/<path>`, `setMyCommands`, `getMe` (валидация токена в `/telegram:configure`). | `external_plugins/telegram` (`server.ts`, скилл `configure`) | Bot token из `~/.claude/channels/telegram/.env` (`TELEGRAM_BOT_TOKEN`, chmod 600) или CC userConfig keychain (`CLAUDE_PLUGIN_OPTION_BOT_TOKEN`). | active | — |

Ограничения Bot API, заложенные в дизайн: нет истории и поиска (reply-only); один `getUpdates`-консьюмер на токен (отсюда bridge/idle-архитектура); скачивание ботом ≤ 20 MB; реакции — только из фиксированного whitelist эмодзи; сообщение ≤ 4096 символов (авто-chunk).

## Internal (между нашими компонентами)

Это плагин, а не сетевой сервис — «внутренние API» это контракт с Claude Code (MCP) и состояние на диске.

| Поверхность | Спецификация | Продюсер | Консьюмер | Статус |
|---|---|---|---|---|
| MCP tools | `reply` (chat_id, text, reply_to?, files?, format?), `react` (chat_id, message_id, emoji), `edit_message` (chat_id, message_id, text, format?), `download_attachment` (file_id) → local path | `server.ts` `ListTools`/`CallTool` | Claude Code (bridge-сессия) | active |
| MCP capabilities | `experimental: { "claude/channel": {}, "claude/channel/permission": {} }` | `server.ts` | Claude Code | active |
| MCP notifications | out: `notifications/claude/channel` (content + meta: chat_id, message_id, user, user_id, ts, image_path?/attachment_*?); `notifications/claude/channel/permission` (request_id, behavior). in: `notifications/claude/channel/permission_request` (request_id, tool_name, description, input_preview) | `server.ts` ↔ Claude Code | двусторонний | active |
| Bot commands (для оператора в Telegram) | `/start`, `/help`, `/status`, `/context`, `/newsession` — DM-only, за `dmCommandGate` | `server.ts` | оператор | active |
| Skills (для оператора в терминале) | `/telegram:configure [<token>|clear]`, `/telegram:access [pair|deny|allow|remove|policy|group|set] …` | `skills/configure`, `skills/access` | оператор | active |
| Disk state | `~/.claude/channels/telegram/`: `access.json` (схема — в `ACCESS.md`; перечитывается на каждое входящее), `.env`, `bot.pid`, `inbox/`, `approved/<senderId>` | `server.ts` ↔ скилл `access` | оба процесса | active — без файловой блокировки, см. тех-долг |
| Env (config) | `TELEGRAM_BOT_TOKEN`, `CLAUDE_PLUGIN_OPTION_BOT_TOKEN`, `TELEGRAM_BRIDGE=1`, `TELEGRAM_STATE_DIR`, `TELEGRAM_ACCESS_MODE=static`, `TELEGRAM_CONTEXT_THRESHOLD`, `TG_BRIDGE_MARKETPLACE`, `TG_BRIDGE_PLUGIN`, `CLAUDE_BIN`, `TG_BRIDGE_TRACE` | оператор / wrapper | `server.ts`, `claude-tg-bridge.sh` | active |

Контракт `claude/channel*` задаётся Claude Code (см. `anthropics/claude-cli-internal`), а не нами — при апгрейде CC перепроверять. Версия CC, на которой проверено: ~2.1.138 (см. README).

## Deprecated / replaced

| Было | Стало | Когда | Почему | ADR |
|---|---|---|---|---|
| inline-button permission UI (`b3a0714`, `4b1e2a2`) | plain-text prompt `y/n <request_id>` (`a41cf45`) | 2026-05 | упрощение; кнопки требовали callback-обработчиков и плохо ложились на телефонный autocorrect | TBD |
| `bot_token` userConfig substitution в `.mcp.json` (`${user_config.bot_token}`) | чтение `CLAUDE_PLUGIN_OPTION_BOT_TOKEN` + `.env`-fallback | 2026-05 | default-syntax не поддерживается; пустой option ломал парсинг манифеста и заодно `.env`-fallback (`228062a`) | TBD |

## Правила ведения

- Новая внешняя зависимость = запись здесь + ADR с альтернативами.
- Изменение контракта (MCP tools/notifications, схема `access.json`, набор bot-команд/скиллов) = обновление этой таблицы + запись в `CHANGELOG.md`.
- Отключили/заменили поверхность → не удаляем строку, переносим в "Deprecated / replaced" с датой и причиной.
