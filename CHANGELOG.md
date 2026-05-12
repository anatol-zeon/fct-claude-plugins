# Changelog

Все заметные изменения документируются здесь. Формат — [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), версионирование — [SemVer](https://semver.org/). Версия проекта = версия плагина `external_plugins/telegram` (`plugin.json`).

## [Unreleased]

### Added
- `docs/deps.md`, `docs/apis.md`, проектный `CLAUDE.md` заполнены (были болванки скелета): реестр зависимостей с обоснованием и проверкой лицензий, поверхность плагина (MCP tools/notifications, схема `access.json`, bot-команды, env), проектные правила (single-user, allowlist, pairing-bootstrap, группы не поддерживаются).
- README: запись `download_attachment` в таблицу tools; явный single-user-фрейминг и пометка про `--dangerously-skip-permissions`-размен.

### Changed
- `external_plugins/telegram/package.json`: `start` теперь `bun install --no-summary --frozen-lockfile && bun server.ts` — плохой апстрим-релиз `grammy`/`@modelcontextprotocol/sdk` больше не подтянется молча при рестарте bridge.

### Fixed
- README, секция «No history or search»: убрано ложное «there's no `download_attachment` tool» — tool существует; описан реальный механизм (фото скачиваются сразу → `image_path`; прочие типы приходят с `attachment_file_id` → `download_attachment`, ≤ 20 MB; исторические сообщения недостижимы).

### Notes
- `ACCESS.md`: секция Groups помечена как unsupported в этом форке (код остаётся, унаследован от апстрима).

## [0.0.9] — pre-release baseline

Состояние плагина `telegram` на момент начала наведения порядка в репозитории (тегов до этого не было; ниже — сводка, не полный git-log).

### Added
- MCP-сервер `server.ts`: tools `reply` / `react` / `edit_message` / `download_attachment`; приём text + photo + document + voice + audio + video + video_note + sticker; авто-chunk длинных ответов; `markdownv2`.
- Access-control: `dmPolicy` `pairing`/`allowlist`/`disabled`; пейринг по 6-символьному коду; группы (`requireMention`, `allowFrom`); mention-детект (`@bot` / reply / regex-паттерны); состояние в `~/.claude/channels/telegram/access.json`, перечитывается на каждое входящее; `TELEGRAM_ACCESS_MODE=static`.
- Permission-relay: `claude/channel/permission` capability; входящий `permission_request` → текст в DM; ответ `y <id>` / `n <id>` перехватывается и шлётся обратно в CC; реакция ✅/❌ на сообщение.
- Bot-команды (DM-only): `/start`, `/help`, `/status`, `/context` (читает session jsonl, считает токены, %% от 200k/1M), `/newsession` (рестарт bridge с чистым контекстом).
- Проактивные предупреждения о заполнении контекста: `TELEGRAM_CONTEXT_THRESHOLD`.
- Bridge-архитектура: `TELEGRAM_BRIDGE=1` → процесс владеет ботом, остальные CC-сессии в idle (один `getUpdates`-консьюмер на токен); чистка зомби-поллеров по `bot.pid`; orphan-watchdog; graceful shutdown; retry-with-backoff поллинга.
- Wrapper: `scripts/claude-tg-bridge.sh` (loop), `claude-with-dev-channels.py` (pexpect авто-подтверждает `--dangerously-load-development-channels`), `claude-tg-bridge.service` (systemd user unit, шаблон).
- Скиллы оператора: `/telegram:configure`, `/telegram:access`.
- Маркетплейс обрезан до `telegram`; апстрим — в `marketplace.upstream.json`.

### Deprecated / replaced
- inline-button permission UI → plain-text prompt `y/n <request_id>`.
- `bot_token` userConfig substitution в `.mcp.json` (`${user_config...}`) → чтение `CLAUDE_PLUGIN_OPTION_BOT_TOKEN` + `.env`-fallback (default-syntax не поддерживается, пустой option ломал парсинг манифеста).

### Known gaps (tech debt — см. `CLAUDE.md` §8)
- Нет тестов; `server.ts` 1221 LOC в одном файле.
- Нет ADR на bridge-архитектуру и выбор `grammy`/`pexpect`.
- Race на `access.json` (server + skill пишут из разных процессов, без файловой блокировки).
- `/context` завязан на «самый свежий jsonl под cwd = эта сессия» и на формат кодирования путей в `~/.claude/projects/`.
