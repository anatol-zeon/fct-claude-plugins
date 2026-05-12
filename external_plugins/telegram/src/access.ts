// Access control for the Telegram channel: who may DM the assistant, which
// groups it listens in, and the pairing-code lifecycle. State lives in
// access.json — the I/O wrappers here take an explicit path so they're
// testable; server.ts layers the STATE_DIR resolution and static mode on top.
//
// The gate is a pure function of (incoming-message-shape, access-state,
// "is the bot mentioned?", clock + code generator). It may mutate the pending
// map and reports whether it did; the caller persists. Keeping it pure of I/O
// and of `Date.now()`/`randomBytes` is what makes the state machine testable.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'

export type PendingEntry = {
  senderId: string
  chatId: string
  createdAt: number
  expiresAt: number
  replies: number
}

export type GroupPolicy = {
  requireMention: boolean
  allowFrom: string[]
}

export type Access = {
  dmPolicy: 'pairing' | 'allowlist' | 'disabled'
  allowFrom: string[]
  groups: Record<string, GroupPolicy>
  pending: Record<string, PendingEntry>
  mentionPatterns?: string[]
  // delivery/UX config — optional, defaults live in the reply handler
  /** Emoji to react with on receipt. Empty string disables. Telegram only accepts its fixed whitelist. */
  ackReaction?: string
  /** Which chunks get Telegram's reply reference when reply_to is passed. Default: 'first'. 'off' = never thread. */
  replyToMode?: 'off' | 'first' | 'all'
  /** Max chars per outbound message before splitting. Default: 4096 (Telegram's hard cap). */
  textChunkLimit?: number
  /** Split on paragraph boundaries instead of hard char count. */
  chunkMode?: 'length' | 'newline'
}

/** The slice of an inbound update the gate reads — grammy's Context is compatible. */
export type InboundCtxShape = {
  from?: { id: number | string; username?: string }
  chat?: { type?: string; id: number | string }
}

const PENDING_TTL_MS = 60 * 60 * 1000 // 1h
const MAX_PENDING = 3
const MAX_PAIR_REPLIES = 2 // initial + one reminder, then silent

export function defaultAccess(): Access {
  return { dmPolicy: 'pairing', allowFrom: [], groups: {}, pending: {} }
}

/** Parse raw access.json text, applying defaults. Throws on invalid JSON. */
export function parseAccess(raw: string): Access {
  const parsed = JSON.parse(raw) as Partial<Access>
  return {
    dmPolicy: parsed.dmPolicy ?? 'pairing',
    allowFrom: parsed.allowFrom ?? [],
    groups: parsed.groups ?? {},
    pending: parsed.pending ?? {},
    mentionPatterns: parsed.mentionPatterns,
    ackReaction: parsed.ackReaction,
    replyToMode: parsed.replyToMode,
    textChunkLimit: parsed.textChunkLimit,
    chunkMode: parsed.chunkMode,
  }
}

/** Remove pending entries whose expiry is before `now`. Returns true if any were removed. */
export function pruneExpired(a: Access, now: number): boolean {
  let changed = false
  for (const [code, p] of Object.entries(a.pending)) {
    if (p.expiresAt < now) {
      delete a.pending[code]
      changed = true
    }
  }
  return changed
}

export type GateResult =
  | { action: 'deliver' }
  | { action: 'drop' }
  | { action: 'pair'; code: string; isResend: boolean }

export type GateOutcome = { result: GateResult; mutated: boolean }

/**
 * Decide what to do with an inbound message. `isMentioned` is consulted only
 * for group chats with requireMention; it's a thunk so DMs don't pay for it.
 * `genCode` mints a fresh pairing code; `now` is the clock. May mutate
 * `access.pending` (and `replies` counters) — `outcome.mutated` says whether
 * it did, so the caller knows to persist.
 */
export function gate(
  ctx: InboundCtxShape,
  access: Access,
  isMentioned: () => boolean,
  { now, genCode }: { now: number; genCode: () => string },
): GateOutcome {
  let mutated = pruneExpired(access, now)
  const done = (result: GateResult): GateOutcome => ({ result, mutated })

  if (access.dmPolicy === 'disabled') return done({ action: 'drop' })

  const from = ctx.from
  if (!from) return done({ action: 'drop' })
  const senderId = String(from.id)
  const chatType = ctx.chat?.type

  if (chatType === 'private') {
    if (access.allowFrom.includes(senderId)) return done({ action: 'deliver' })
    if (access.dmPolicy === 'allowlist') return done({ action: 'drop' })

    // pairing mode — reuse an existing non-expired code for this sender
    for (const [code, p] of Object.entries(access.pending)) {
      if (p.senderId === senderId) {
        if ((p.replies ?? 1) >= MAX_PAIR_REPLIES) return done({ action: 'drop' })
        p.replies = (p.replies ?? 1) + 1
        mutated = true
        return done({ action: 'pair', code, isResend: true })
      }
    }
    if (Object.keys(access.pending).length >= MAX_PENDING) return done({ action: 'drop' })

    const code = genCode()
    access.pending[code] = {
      senderId,
      chatId: String(ctx.chat!.id),
      createdAt: now,
      expiresAt: now + PENDING_TTL_MS,
      replies: 1,
    }
    mutated = true
    return done({ action: 'pair', code, isResend: false })
  }

  if (chatType === 'group' || chatType === 'supergroup') {
    const groupId = String(ctx.chat!.id)
    const policy = access.groups[groupId]
    if (!policy) return done({ action: 'drop' })
    const groupAllowFrom = policy.allowFrom ?? []
    const requireMention = policy.requireMention ?? true
    if (groupAllowFrom.length > 0 && !groupAllowFrom.includes(senderId)) return done({ action: 'drop' })
    if (requireMention && !isMentioned()) return done({ action: 'drop' })
    return done({ action: 'deliver' })
  }

  return done({ action: 'drop' })
}

/**
 * Like `gate` but for bot commands: DM-only, no pairing side effects. Returns
 * the sender id if the command should be answered, null to drop. In `pairing`
 * mode it accepts anyone so unpaired users can run `/status`. Caller is
 * responsible for pruning expired pending entries beforehand if it cares.
 */
export function dmCommandGate(
  ctx: InboundCtxShape,
  access: Access,
): { senderId: string } | null {
  if (ctx.chat?.type !== 'private') return null
  if (!ctx.from) return null
  if (access.dmPolicy === 'disabled') return null
  const senderId = String(ctx.from.id)
  if (access.dmPolicy === 'allowlist' && !access.allowFrom.includes(senderId)) return null
  return { senderId }
}

/**
 * Outbound gate — reply/react/edit can only target chats the inbound gate would
 * deliver from. Telegram DM chat_id == user_id, so allowFrom covers DMs.
 */
export function assertAllowedChat(chat_id: string, access: Access): void {
  if (access.allowFrom.includes(chat_id)) return
  if (chat_id in access.groups) return
  throw new Error(`chat ${chat_id} is not allowlisted — add via /telegram:access`)
}

// ── persistence ──────────────────────────────────────────────────────────────

/**
 * Read access.json at `accessFile`. A missing file is equivalent to the default
 * (so the first DM triggers pairing). A corrupt file is moved aside and replaced
 * with defaults rather than crashing the channel.
 */
export function readAccessFile(accessFile: string): Access {
  let raw: string
  try {
    raw = readFileSync(accessFile, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultAccess()
    throw err
  }
  try {
    return parseAccess(raw)
  } catch {
    try {
      renameSync(accessFile, `${accessFile}.corrupt-${Date.now()}`)
    } catch {}
    process.stderr.write('telegram channel: access.json is corrupt, moved aside. Starting fresh.\n')
    return defaultAccess()
  }
}

/** Atomically write access.json (pretty-printed, owner-only) to `accessFile`. */
export function saveAccess(a: Access, stateDir: string, accessFile: string): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const tmp = accessFile + '.tmp'
  writeFileSync(tmp, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, accessFile)
}
