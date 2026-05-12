# Dependencies (human-readable SBOM)

Реестр зависимостей с обоснованием. Это **не замена** `package.json`/`pyproject.toml`, а ответ на вопрос "зачем".

Проект состоит из одного плагина — `external_plugins/telegram/` (Telegram-канал для Claude Code). Зависимости ниже — его.

## Runtime dependencies

| Пакет | Версия (в lockfile) | Зачем | Используется в | Лицензия | Альтернативы рассмотрены |
|---|---|---|---|---|---|
| `bun` | 1.3.x (host runtime) | Рантайм MCP-сервера; `.mcp.json` запускает `bun run ... start`. TS без отдельного build-шага. | весь `server.ts` | MIT | Node + tsx — отвергнуто: лишний build/loader-шаг; апстримный плагин уже на bun. |
| `grammy` | `^1.21.0` → 1.41.1 | Telegram Bot API SDK: long-polling (`getUpdates`), отправка сообщений/фото/документов, реакции, edit, `setMyCommands`. | `server.ts` (`Bot`, `GrammyError`, `InputFile`, `Context`) | MIT | `node-telegram-bot-api`, `telegraf` — отвергнуто: grammy активнее поддерживается, типобезопаснее, апстримный плагин уже на нём. |
| `@modelcontextprotocol/sdk` | `^1.0.0` → 1.27.1 | MCP server: stdio-транспорт, регистрация tools, `claude/channel` + `claude/channel/permission` capabilities, нотификации. | `server.ts` (`Server`, `StdioServerTransport`, request/notification schemas) | MIT | NA — канонический SDK для MCP. |
| `pexpect` (Python 3) | `4.9.0` (host) | Только для bridge-обёртки `scripts/claude-tg-bridge.sh`: цепляет `claude` к pty и авто-подтверждает одноразовое меню `--dangerously-load-development-channels`. | `scripts/claude-with-dev-channels.py` | ISC | `expect(1)` (Tcl) — отвергнуто: лишняя системная зависимость; pexpect ставится `pip install --user`. Самописный pty-драйвер — отвергнуто: pexpect это и есть. |

## Dev / build dependencies

| Пакет | Версия | Зачем | Лицензия |
|---|---|---|---|
| `bun:test` | (входит в `bun`) | Тест-раннер. `bun test` подхватывает `src/**/*.test.ts`. Не отдельная зависимость. | MIT (bun) |
| `typescript` (`tsc`) | через `bunx tsc` | Типчек: `bun run typecheck` → `bunx tsc -p tsconfig.json --noEmit`. Ставится эфемерно через `bunx`, **не** в `package.json` (иначе тянулся бы на bridge-хост через `start`'s `bun install`). | Apache-2.0 |

Нет ESLint/Prettier — стиль держим вручную, форматирование тривиальное.

## Removed dependencies (archive)

| Пакет | Когда убрали | Почему | Заменён на |
|---|---|---|---|
| _(нет)_ | | | |

## Правила ведения

- Новая зависимость = запись здесь + (если архитектурное влияние) ADR.
- Проверка: MIT/Apache/BSD/ISC — ок. GPL/AGPL — обсуждать до установки. Все текущие — MIT/ISC, ок.
- Raw list — `external_plugins/telegram/package.json` + `bun.lock`. Этот файл — про "почему".
- `start`-скрипт запускается с `--frozen-lockfile` — обновление версии зависимости = пересборка `bun.lock` отдельным коммитом + строка здесь.
- Удалили зависимость → запись в "Removed", не удаление строки из "Runtime".
