import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  assertAllowedChat,
  defaultAccess,
  dmCommandGate,
  gate,
  parseAccess,
  pruneExpired,
  readAccessFile,
  saveAccess,
  type Access,
} from './access'

// ── helpers ──────────────────────────────────────────────────────────────────
const fresh = (over: Partial<Access> = {}): Access => ({ ...defaultAccess(), ...over })
const dm = (id: number) => ({ from: { id }, chat: { type: 'private', id } })
const grp = (gid: number, uid: number, type: 'group' | 'supergroup' = 'supergroup') => ({
  from: { id: uid },
  chat: { type, id: gid },
})
const opts = (now = 1_000, code = 'aaaaaa') => ({ now, genCode: () => code })
const never = () => false
const always = () => true

// ── pruneExpired ─────────────────────────────────────────────────────────────
describe('pruneExpired', () => {
  test('drops only entries whose expiresAt is before now', () => {
    const a = fresh({
      pending: {
        old: { senderId: '1', chatId: '1', createdAt: 0, expiresAt: 500, replies: 1 },
        live: { senderId: '2', chatId: '2', createdAt: 0, expiresAt: 5000, replies: 1 },
      },
    })
    expect(pruneExpired(a, 1000)).toBe(true)
    expect(Object.keys(a.pending)).toEqual(['live'])
  })

  test('returns false when nothing expired', () => {
    const a = fresh({ pending: { live: { senderId: '2', chatId: '2', createdAt: 0, expiresAt: 5000, replies: 1 } } })
    expect(pruneExpired(a, 1000)).toBe(false)
  })
})

// ── parseAccess / defaultAccess ──────────────────────────────────────────────
describe('parseAccess', () => {
  test('fills defaults for a minimal object', () => {
    expect(parseAccess('{}')).toEqual(defaultAccess())
  })

  test('keeps known fields and the optional delivery config', () => {
    const parsed = parseAccess(JSON.stringify({
      dmPolicy: 'allowlist',
      allowFrom: ['42'],
      ackReaction: '👀',
      replyToMode: 'all',
      textChunkLimit: 2000,
      chunkMode: 'newline',
      mentionPatterns: ['^hi'],
    }))
    expect(parsed.dmPolicy).toBe('allowlist')
    expect(parsed.allowFrom).toEqual(['42'])
    expect(parsed.ackReaction).toBe('👀')
    expect(parsed.replyToMode).toBe('all')
    expect(parsed.textChunkLimit).toBe(2000)
    expect(parsed.chunkMode).toBe('newline')
    expect(parsed.mentionPatterns).toEqual(['^hi'])
  })

  test('throws on invalid JSON (callers handle the corrupt-file case)', () => {
    expect(() => parseAccess('{not json')).toThrow()
  })
})

// ── assertAllowedChat ────────────────────────────────────────────────────────
describe('assertAllowedChat', () => {
  test('allows a chat in allowFrom', () => {
    expect(() => assertAllowedChat('7', fresh({ allowFrom: ['7'] }))).not.toThrow()
  })
  test('allows a chat that is an enabled group', () => {
    expect(() => assertAllowedChat('-100123', fresh({ groups: { '-100123': { requireMention: true, allowFrom: [] } } }))).not.toThrow()
  })
  test('throws for an unknown chat', () => {
    expect(() => assertAllowedChat('999', fresh())).toThrow(/not allowlisted/)
  })
})

// ── gate: DMs ────────────────────────────────────────────────────────────────
describe('gate — DMs', () => {
  test('disabled policy drops everything, even allowlisted senders', () => {
    const a = fresh({ dmPolicy: 'disabled', allowFrom: ['5'] })
    expect(gate(dm(5), a, never, opts()).result).toEqual({ action: 'drop' })
  })

  test('a message with no sender is dropped', () => {
    expect(gate({ chat: { type: 'private', id: 5 } }, fresh(), never, opts()).result).toEqual({ action: 'drop' })
  })

  test('an allowlisted sender is delivered (and nothing is mutated)', () => {
    const out = gate(dm(5), fresh({ allowFrom: ['5'] }), never, opts())
    expect(out.result).toEqual({ action: 'deliver' })
    expect(out.mutated).toBe(false)
  })

  test('allowlist policy silently drops an unknown sender', () => {
    expect(gate(dm(9), fresh({ dmPolicy: 'allowlist' }), never, opts()).result).toEqual({ action: 'drop' })
  })

  test('pairing policy mints a code for an unknown sender and records it', () => {
    const a = fresh()
    const out = gate(dm(9), a, never, opts(1_000, 'c0de00'))
    expect(out.result).toEqual({ action: 'pair', code: 'c0de00', isResend: false })
    expect(out.mutated).toBe(true)
    expect(a.pending['c0de00']).toMatchObject({ senderId: '9', chatId: '9', replies: 1 })
    expect(a.pending['c0de00'].expiresAt).toBe(1_000 + 60 * 60 * 1000)
  })

  test('a second message from a pending sender resends the same code (reminder), once', () => {
    const a = fresh({ pending: { abc123: { senderId: '9', chatId: '9', createdAt: 0, expiresAt: 9e9, replies: 1 } } })
    const out = gate(dm(9), a, never, opts(1_000))
    expect(out.result).toEqual({ action: 'pair', code: 'abc123', isResend: true })
    expect(a.pending['abc123'].replies).toBe(2)
  })

  test('after the reminder, further messages from a pending sender go silent', () => {
    const a = fresh({ pending: { abc123: { senderId: '9', chatId: '9', createdAt: 0, expiresAt: 9e9, replies: 2 } } })
    expect(gate(dm(9), a, never, opts()).result).toEqual({ action: 'drop' })
  })

  test('pending is capped at 3 — a 4th distinct sender is dropped', () => {
    const a = fresh({
      pending: {
        p1: { senderId: '1', chatId: '1', createdAt: 0, expiresAt: 9e9, replies: 1 },
        p2: { senderId: '2', chatId: '2', createdAt: 0, expiresAt: 9e9, replies: 1 },
        p3: { senderId: '3', chatId: '3', createdAt: 0, expiresAt: 9e9, replies: 1 },
      },
    })
    expect(gate(dm(4), a, never, opts()).result).toEqual({ action: 'drop' })
  })

  test('expired pending entries are pruned before gating, freeing a slot', () => {
    const a = fresh({ pending: { stale: { senderId: '1', chatId: '1', createdAt: 0, expiresAt: 500, replies: 1 } } })
    const out = gate(dm(9), a, never, opts(1_000, 'newone'))
    expect(out.result).toEqual({ action: 'pair', code: 'newone', isResend: false })
    expect(a.pending['stale']).toBeUndefined()
    expect(a.pending['newone']).toBeDefined()
  })
})

// ── gate: groups ─────────────────────────────────────────────────────────────
describe('gate — groups', () => {
  test('a group with no policy is dropped', () => {
    expect(gate(grp(-100, 5), fresh(), always, opts()).result).toEqual({ action: 'drop' })
  })

  test('requireMention drops an un-mentioning message and delivers a mentioning one', () => {
    const a = fresh({ groups: { '-100': { requireMention: true, allowFrom: [] } } })
    expect(gate(grp(-100, 5), a, never, opts()).result).toEqual({ action: 'drop' })
    expect(gate(grp(-100, 5), a, always, opts()).result).toEqual({ action: 'deliver' })
  })

  test('requireMention:false delivers any member’s message', () => {
    const a = fresh({ groups: { '-100': { requireMention: false, allowFrom: [] } } })
    expect(gate(grp(-100, 5), a, never, opts()).result).toEqual({ action: 'deliver' })
  })

  test('a non-empty group allowFrom restricts who can trigger the bot', () => {
    const a = fresh({ groups: { '-100': { requireMention: false, allowFrom: ['5'] } } })
    expect(gate(grp(-100, 5), a, never, opts()).result).toEqual({ action: 'deliver' })
    expect(gate(grp(-100, 6), a, never, opts()).result).toEqual({ action: 'drop' })
  })

  test('plain "group" type works the same as "supergroup"', () => {
    const a = fresh({ groups: { '-100': { requireMention: false, allowFrom: [] } } })
    expect(gate(grp(-100, 5, 'group'), a, never, opts()).result).toEqual({ action: 'deliver' })
  })

  test('channel posts and other chat types are dropped', () => {
    expect(gate({ from: { id: 5 }, chat: { type: 'channel', id: -100 } }, fresh(), always, opts()).result).toEqual({ action: 'drop' })
  })
})

// ── dmCommandGate ────────────────────────────────────────────────────────────
describe('dmCommandGate', () => {
  test('rejects non-private chats and messages with no sender', () => {
    expect(dmCommandGate(grp(-100, 5), fresh())).toBeNull()
    expect(dmCommandGate({ chat: { type: 'private', id: 5 } }, fresh())).toBeNull()
  })
  test('disabled policy rejects', () => {
    expect(dmCommandGate(dm(5), fresh({ dmPolicy: 'disabled', allowFrom: ['5'] }))).toBeNull()
  })
  test('allowlist policy rejects strangers, accepts allowlisted', () => {
    expect(dmCommandGate(dm(9), fresh({ dmPolicy: 'allowlist' }))).toBeNull()
    expect(dmCommandGate(dm(5), fresh({ dmPolicy: 'allowlist', allowFrom: ['5'] }))).toEqual({ senderId: '5' })
  })
  test('pairing policy accepts anyone (so unpaired users can /status)', () => {
    expect(dmCommandGate(dm(9), fresh())).toEqual({ senderId: '9' })
  })
})

// ── readAccessFile / saveAccess (fs) ─────────────────────────────────────────
describe('readAccessFile / saveAccess (fs)', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tg-access-'))
    file = join(dir, 'access.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test('a missing file reads as the default access', () => {
    expect(readAccessFile(file)).toEqual(defaultAccess())
  })

  test('round-trips through saveAccess', () => {
    const a = fresh({ dmPolicy: 'allowlist', allowFrom: ['1', '2'] })
    saveAccess(a, dir, file)
    expect(readAccessFile(file)).toEqual(a)
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true) // pretty-printed, trailing newline
  })

  test('a corrupt file is moved aside and replaced with defaults', () => {
    writeFileSync(file, '{ totally broken')
    expect(readAccessFile(file)).toEqual(defaultAccess())
    expect(existsSync(file)).toBe(false)
    expect(readdirSync(dir).some(n => n.startsWith('access.json.corrupt-'))).toBe(true)
  })
})
