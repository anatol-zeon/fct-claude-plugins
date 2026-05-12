import { describe, expect, test } from 'bun:test'
import { matchPermissionReply, PERMISSION_REPLY_RE } from './permissions'

describe('matchPermissionReply', () => {
  test('accepts "y <id>" and "n <id>"', () => {
    expect(matchPermissionReply('y abcde')).toEqual({ requestId: 'abcde', behavior: 'allow' })
    expect(matchPermissionReply('n abcde')).toEqual({ requestId: 'abcde', behavior: 'deny' })
  })

  test('accepts the long forms yes/no', () => {
    expect(matchPermissionReply('yes abcde')).toEqual({ requestId: 'abcde', behavior: 'allow' })
    expect(matchPermissionReply('no zzzzz')).toEqual({ requestId: 'zzzzz', behavior: 'deny' })
  })

  test('is case-insensitive (phone autocorrect) and normalizes the id to lowercase', () => {
    expect(matchPermissionReply('Y ABCDE')).toEqual({ requestId: 'abcde', behavior: 'allow' })
    expect(matchPermissionReply('YES AbCdE')).toEqual({ requestId: 'abcde', behavior: 'allow' })
  })

  test('tolerates surrounding whitespace', () => {
    expect(matchPermissionReply('  y abcde  ')).toEqual({ requestId: 'abcde', behavior: 'allow' })
  })

  test('rejects ids containing the ambiguous letter "l"', () => {
    expect(matchPermissionReply('y ablde')).toBeNull()
    expect(matchPermissionReply('y lllll')).toBeNull()
  })

  test('rejects ids that are not exactly 5 letters', () => {
    expect(matchPermissionReply('y abcd')).toBeNull()
    expect(matchPermissionReply('y abcdef')).toBeNull()
    expect(matchPermissionReply('y abc12')).toBeNull()
  })

  test('rejects bare yes/no with no id (conversational), and prefix/suffix chatter', () => {
    expect(matchPermissionReply('yes')).toBeNull()
    expect(matchPermissionReply('no')).toBeNull()
    expect(matchPermissionReply('please y abcde')).toBeNull()
    expect(matchPermissionReply('y abcde please')).toBeNull()
    expect(matchPermissionReply('yeah abcde')).toBeNull()
  })

  test('rejects ordinary chat', () => {
    expect(matchPermissionReply('what is the status')).toBeNull()
    expect(matchPermissionReply('')).toBeNull()
  })

  test('the underlying regex is exported for reference', () => {
    expect(PERMISSION_REPLY_RE.test('y abcde')).toBe(true)
    expect(PERMISSION_REPLY_RE.test('nope')).toBe(false)
  })
})
