# 3. Runtime and library stack for the Telegram channel plugin

Date: 2026-05-12

## Status

Accepted

## Context

The `telegram` plugin is a fork of the upstream `anthropics/claude-code-plugins` `telegram` entry. Most of its stack is inherited; this ADR records why each piece stays, and documents the one library the fork *adds* — `pexpect` — per the project rule "any new lib → context7 → alternatives → ADR".

The fork-specific need: this isn't on Anthropic's curated channel-plugin allowlist, so the bridge must be launched with `--dangerously-load-development-channels <plugin-entry>` (see ADR-0004). As of CC ~2.1.138 that flag triggers an interactive one-time "Loading development channels" confirmation menu on every session start. For an unattended wrapper loop (tmux / systemd) that's a blocker — something has to press Enter.

## Decision

**Runtime: Bun** (inherited from upstream). `.mcp.json` runs `bun run … start`; `start` = `bun install --no-summary --frozen-lockfile && bun server.ts`. Bun executes the TypeScript directly — no separate build/transpile/loader step, no `tsconfig` gymnastics. `--frozen-lockfile` (added in this fork) makes installs honor the committed `bun.lock` and fail loudly on drift.

**Telegram SDK: `grammy`** (inherited). Long-polling, `sendMessage`/`sendPhoto`/`sendDocument`, `setMessageReaction`, `editMessageText`, `getFile`, `setMyCommands`; typed `Context`. Actively maintained, good types.

**MCP: `@modelcontextprotocol/sdk`** (inherited). The canonical SDK — stdio transport, tool registration, `claude/channel` + `claude/channel/permission` experimental capabilities, notifications. No alternative.

**Bridge dev-channels prompt: a Python `pexpect` helper** (`scripts/claude-with-dev-channels.py`, added in this fork). It `spawn`s `claude` on a pty (wide dimensions so the menu doesn't wrap), watches for the contiguous word `Loading`, waits a short settle, sends a bare `\r`, mirrors `claude`'s output to stderr, then waits for EOF and mirrors the exit code. The wrapper (`claude-tg-bridge.sh`) calls it in a loop.

Licenses: bun MIT, grammy MIT, @modelcontextprotocol/sdk MIT, pexpect ISC — all fine per project policy. Recorded in `docs/deps.md`.

## Consequences

- The bridge host needs `bun`, `python3`, and `pexpect` (`pip install --user pexpect`) on `PATH`, plus `claude` itself. Systemd user units don't inherit a login shell `PATH`, so the unit template hardcodes the likely locations.
- The pexpect matcher is coupled to CC's menu rendering: it anchors on the single word `Loading` because CC draws each menu word as its own ANSI-styled cell (multi-word patterns never match the raw pty stream), and sends `\r` because CC's menus read raw-mode key input where `sendline()`'s platform linesep doesn't register. If CC changes the menu text or input handling, the helper breaks and the bridge hangs on the prompt. `TG_BRIDGE_TRACE=/path` dumps the raw pty stream for re-diagnosis.
- `--frozen-lockfile`: bumping a dependency now requires regenerating `bun.lock` in a deliberate commit (+ a line in `docs/deps.md`), which is the point.

## Alternatives considered

- **Node + `tsx`/`ts-node` instead of Bun** — extra loader/build step; upstream already ships bun. Rejected.
- **`node-telegram-bot-api` / `telegraf` instead of grammy** — grammy is better-typed and more active, and it's upstream's choice. No reason to diverge. Rejected.
- **Tcl `expect(1)` instead of pexpect** — an extra system package to install vs. a `pip install --user`. Rejected.
- **Hand-rolled pty driver** (Node `child_process` + a raw pty) — that's exactly what pexpect is; reinventing it is pure risk. Rejected.
- **A documented flag to suppress the dev-channels prompt** — none exists in CC ~2.1.138. If one ships later, drop the pexpect helper and call `claude` directly. Revisit on CC upgrades.
- **Get the fork onto Anthropic's curated channel-plugin allowlist** — out of scope for a personal fork; would remove the need for `--dangerously-load-development-channels` and thus the helper entirely. Not pursued.
