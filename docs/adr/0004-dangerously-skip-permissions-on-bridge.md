# 4. `--dangerously-skip-permissions` on the bridge session

Date: 2026-05-12

## Status

Accepted

## Context

The bridge wrapper (`scripts/claude-tg-bridge.sh`) launches the inner Claude session with `--dangerously-skip-permissions` — every tool call (Bash, Write, Edit, …) runs without a permission prompt. The bridge is meant to run unattended (tmux / systemd) and be driven from a phone over Telegram; an operator who can't see the terminal can't approve prompts there.

The plugin *does* implement a permission-relay path (`claude/channel/permission` capability: CC sends a `permission_request`, the server DMs it as `🔐 Permission [id]: …`, the operator replies `y id` / `n id`). But with `--dangerously-skip-permissions` there is nothing to relay — CC never asks. So in the as-shipped bridge configuration the relay is dormant.

This is a single-user fork: the only intended user is the owner, on the owner's own host. (See the project `CLAUDE.md` §7.)

## Decision

**Run the bridge with `--dangerously-skip-permissions`. Accept that the access allowlist + the operator's Telegram account security are the trust boundary, and design around that.**

Consequences that follow, and the mitigations already in place:

- **`access.json` `allowFrom` is a shell-access-equivalent boundary.** An inbound DM from an allowlisted sender flows into a Claude that will run any command. Therefore: steady-state `dmPolicy` is `allowlist` with exactly the owner's numeric ID; `pairing` is kept only as a one-time ID-capture bootstrap and is turned off immediately after (`/telegram:configure` actively pushes this lockdown); groups are unsupported in this fork; the operator's Telegram account should have 2FA.
- **Message content is untrusted input to a YOLO-mode agent.** Mitigations: the MCP server's `instructions` tell Claude to refuse any access mutation requested via a channel message; the `/telegram:access` and `/telegram:configure` skills refuse to act on channel-originated requests; security-sensitive meta (`image_path`, `attachment_file_id`) is delivered in the notification `meta` block, never inline in `content` where an allowlisted sender could forge it; uploader-controlled filenames are sanitized before they enter the `<channel>` block.
- **The relay stays in the codebase** (capability declared, handlers wired). If a future deployment runs the bridge *without* `--dangerously-skip-permissions`, permission prompts route to DMs automatically — no code change needed. The relay is also why the server declares it authenticates the replier: `gate()`/`allowFrom` already dropped non-allowlisted senders before any reply is processed.
- **Outbound is gated too.** `reply`/`react`/`edit_message` can only target chats the inbound gate would deliver from (`assertAllowedChat`); the `files:` param of `reply` refuses to send the channel's own state dir (`assertSendable`) — though it will send other arbitrary paths, which is a known residual exfil surface (an allowlisted prompt-injection could ask for `reply files:["~/.ssh/id_rsa"]`).

## Consequences

- For the intended single-operator setup this is a deliberate convenience trade-off, not an oversight. It must be documented as such (done: project `CLAUDE.md`, plugin `README.md`).
- It would be **unacceptable** to ship this configuration for a multi-user / shared deployment. Such a deployment must drop `--dangerously-skip-permissions` (the relay then activates) and re-evaluate the group story.
- Residual risks accepted for now: arbitrary-path attachment exfil via `reply files:`; full host capability if the owner's Telegram account is compromised. Revisit if the fork ever becomes multi-user.

## Alternatives considered

- **Bridge without `--dangerously-skip-permissions`, relay every prompt to DMs** — works, but a real session fires many permission prompts; approving each from a phone is painful enough that the bridge becomes unpleasant to use. Rejected for the single-operator case; this is the *required* mode if the fork goes multi-user.
- **Allow-list specific tools instead of skip-all** (a curated `--allowedTools` set) — narrows the blast radius but still needs prompts for anything outside the set, so it has the same UX problem partially; and a Telegram-driven assistant legitimately needs broad tool access. Not pursued now; a reasonable future hardening step.
- **Tighten `assertSendable` to an allowlist of sendable directories** — would close the `reply files:` exfil surface. Deferred; noted as residual.
