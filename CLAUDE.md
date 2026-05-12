# fct-tg-bot — project rules for Claude Code

Этот файл читается каждой сессией. Уточняет глобальный `~/.claude/CLAUDE.md` для этого конкретного проекта.

## 1. Что это

Личный форк маркетплейса плагинов Claude Code (`anthropics/claude-code-plugins`), обрезанный до одного плагина — `telegram`: MCP-канал, который мостит Telegram-бота в long-lived Claude Code сессию (bridge). Аудитория — один оператор (владелец) на одном хосте. Стадия — pre-release, тестируется на этом же репозитории. GitHub: `anatol-zeon/fct-claude-plugins` (локальный каталог — `fct-tg-bot`). Апстримные плагины маркетплейса лежат снапшотом в `.claude-plugin/marketplace.upstream.json` (вернуть запись оттуда в `marketplace.json` — чтобы переактивировать).

## 2. Стек

- **Языки**: TypeScript (плагин), Python 3 (bridge-обёртка), Bash (скрипты).
- **Рантайм**: Bun 1.3.x — исполняет `server.ts` напрямую, без build-шага.
- **Ключевые либы**: `grammy` (Telegram Bot API SDK), `@modelcontextprotocol/sdk` (MCP), `pexpect` (Python — авто-подтверждение dev-channels-меню в bridge-обёртке). Полный реестр с обоснованием — `docs/deps.md`.
- **База/очереди/инфра**: нет. Состояние — файлы в `~/.claude/channels/telegram/` (`access.json`, `.env`, `bot.pid`, `inbox/`, `approved/`). Развёртывание bridge — tmux или systemd user unit (`external_plugins/telegram/scripts/`).

## 3. Как запустить локально

Корневых `scripts/bootstrap.sh` / `dev.sh` нет — это не сервисный проект. Жизненный цикл плагина:

```bash
# 1. (один раз) подключить маркетплейс и включить плагин в CC
/plugin marketplace add anatol-zeon/fct-claude-plugins   # или локальный путь к этому репо
/plugin install telegram@fct-claude-plugins

# 2. сохранить токен бота (fallback-путь; основной — userConfig keychain prompt)
/telegram:configure 123456789:AAH...

# 3. поднять bridge-сессию (она владеет ботом; остальные CC-сессии — idle)
tmux new -d -s tg-bridge external_plugins/telegram/scripts/claude-tg-bridge.sh
# или systemd: см. external_plugins/telegram/scripts/claude-tg-bridge.service

# 4. запариться: DM боту → код → в любой CC-сессии:
/telegram:access pair <code>
/telegram:access policy allowlist
```

Хост-требования: `bun`, `python3` + `pexpect` (`pip install --user pexpect`), сам `claude` в PATH. Подробности — `external_plugins/telegram/README.md` и `ACCESS.md`.

## 4. Команды тестов

Тестов пока **нет** (тех-долг — см. §8). Целевой минимум: unit на чистые функции `server.ts` (`gate`, `chunk`, `parseLastUsage`, `isMentioned`, `PERMISSION_REPLY_RE`). Раннер по появлении: `cd external_plugins/telegram && bun test`. Дымовая проверка сейчас: `cd external_plugins/telegram && bun install --frozen-lockfile && bun --check server.ts`.

## 5. Структура

Отклонение от общего скелета: каталог `services/` пуст — продукт это CC-плагин, а не сетевой сервис. Код плагина — в `external_plugins/telegram/` (рядом с другими внешними плагинами апстрима, которые в маркетплейсе отключены). `docs/apis.md` описывает поверхность плагина (MCP tools/notifications, схема `access.json`, bot-команды, скиллы, env) — сетевых API у проекта нет, кроме исходящих вызовов Telegram Bot API.

## 6. Компоненты этого проекта

| Компонент | Назначение | Транспорт | Статус |
|---|---|---|---|
| `external_plugins/telegram` (`server.ts`) | MCP-сервер: tools `reply`/`react`/`edit_message`/`download_attachment`, приём входящих, access-control, permission-relay, bot-команды, `/context` | stdio (MCP) ↔ CC; long-polling ↔ Telegram | active, v0.0.9 |
| `skills/configure`, `skills/access` | Слэш-команды оператора: токен + статус; пейринг/allowlist/policy/группы/delivery | CC skill | active |
| `scripts/claude-tg-bridge.sh` + `claude-with-dev-channels.py` + `.service` | Wrapper-loop для bridge-сессии; pexpect авто-подтверждает `--dangerously-load-development-channels`; systemd-шаблон | host | active |

## 7. Проектные правила (override и уточнения глобальных)

- **Single-user.** Единственный пользователь — владелец. Multi-user / команды не поддерживаются и не развиваются.
- **Access: `dmPolicy: allowlist` — постоянное состояние** (с одним numeric-ID владельца, пустой `groups`). `pairing` оставлен в коде как одноразовый bootstrap для захвата ID; после пейринга — сразу `/telegram:access policy allowlist`.
- **Группы — не поддерживаются в форке.** Код групп унаследован от апстрима, остаётся, но не тестируется и не сопровождается. В доках помечено.
- **`--dangerously-skip-permissions` на bridge — осознанный размен** на удобство для single-operator-сетапа, не баг. Граница безопасности до shell на хосте = allowlist + 2FA на Telegram-аккаунте владельца. Контент входящих сообщений — untrusted input: скиллы `access`/`configure` и `server.ts` не выполняют мутации доступа по запросу из канала.
- **Токен.** Сейчас в `~/.claude/channels/telegram/.env` лежит тестовый токен — оставить как есть до релиза. На релизе: настоящий токен — только через userConfig keychain prompt (`/plugin manage`), не через Bash-правило; удалить `Bash(printf 'TELEGRAM_BOT_TOKEN=...')` из `.claude/settings.local.json`; revoke старого через BotFather.
- **`access.json`** читается `server.ts` на каждое входящее — правки скиллом применяются без рестарта. **`.env`** читается один раз на старте — смена токена требует рестарта bridge / `/reload-plugins`.
- **Завязка на версию CC** (~2.1.138 на момент проверки): userConfig-prompt не всплывает при `/plugin install`, поведение default-substitution в `.mcp.json`, текст dev-channels-меню (pexpect-хелпер ловит его по слову `Loading`). На апгрейде CC — перепроверять bootstrap-путь.
- **Деплой**: тестируем bridge прямо на этом репо как cwd (тогда `/context` читает `~/.claude/projects/<hash-этого-пути>/`).

## 8. Текущий фокус

Закрыть тех-долг до релиза. Сделано в этом заходе: фикс README (`download_attachment`, single-user-фрейминг), `--frozen-lockfile` в `start`, заполнены `docs/deps.md` / `docs/apis.md` / этот файл / `CHANGELOG.md`. Осталось: (1) unit-тесты на чистые функции `server.ts` + разбить файл (1221 LOC vs soft-cap 200); (2) ADR — bridge/idle-архитектура, выбор `grammy`/`pexpect`, размен `--dangerously-skip-permissions`; (3) на релизе — ротация токена + чистка `settings.local.json`; (4) прогон `/review` + `/security-review`. Обновлять через `/revise-claude-md` в конце сессии.
