import { describe, expect, test } from 'bun:test'
import { findAncestorPid } from './lifecycle'

// Helper: build a fake process tree from a {child: parent} map.
const tree = (rels: Record<number, number>) =>
  (pid: number): number | null => rels[pid] ?? null

describe('findAncestorPid', () => {
  test('returns startPid itself when it matches', () => {
    const readPpid = tree({ 10: 5, 5: 1 })
    expect(findAncestorPid(10, p => p === 10, readPpid)).toBe(10)
  })

  test('walks up to the first matching ancestor', () => {
    // 100 (bun server) → 99 (bun run) → 98 (claude) → 50 (python helper) → 1
    const readPpid = tree({ 100: 99, 99: 98, 98: 50, 50: 1 })
    expect(findAncestorPid(100, p => p === 98, readPpid)).toBe(98)
  })

  test('returns null when no ancestor matches', () => {
    const readPpid = tree({ 100: 99, 99: 1 })
    expect(findAncestorPid(100, () => false, readPpid)).toBeNull()
  })

  test('stops at pid 1 (init) without considering it', () => {
    const readPpid = tree({ 100: 99, 99: 1 })
    // matcher would say "1 is the one!" — we should still stop and refuse to signal init.
    expect(findAncestorPid(100, p => p === 1, readPpid)).toBeNull()
  })

  test('stops when readPpid returns null (orphan / unreadable /proc)', () => {
    const readPpid = (pid: number) => (pid === 100 ? 99 : null)
    expect(findAncestorPid(100, p => p === 50, readPpid)).toBeNull()
  })

  test('respects maxDepth to avoid pathological loops', () => {
    // self-referencing parent (shouldn't happen in real /proc, but defensive)
    const readPpid = (pid: number) => pid
    expect(findAncestorPid(100, () => false, readPpid, 5)).toBeNull()
  })

  test('a startPid of 0 or 1 returns null immediately', () => {
    const readPpid = tree({})
    expect(findAncestorPid(0, () => true, readPpid)).toBeNull()
    expect(findAncestorPid(1, () => true, readPpid)).toBeNull()
  })
})
