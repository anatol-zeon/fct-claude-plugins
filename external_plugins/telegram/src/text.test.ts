import { describe, expect, test } from 'bun:test'
import { chunk, MAX_CHUNK_LIMIT, PHOTO_EXTS } from './text'

// Characterization tests: chunk() is moved verbatim from server.ts; these pin
// down its (slightly quirky) behaviour so a future rewrite can't silently
// regress it. Where the behaviour is itself a bit odd (a cut at a space leaves
// the space as a leading char of the next chunk; trailing newlines on a chunk
// aren't trimmed) the test documents the real behaviour, not a wished-for one.

describe('chunk', () => {
  test('returns the text unchanged when within the limit', () => {
    expect(chunk('hello', 10, 'length')).toEqual(['hello'])
    expect(chunk('', 10, 'length')).toEqual([''])
  })

  test('text exactly at the limit is one chunk', () => {
    expect(chunk('abcde', 5, 'length')).toEqual(['abcde'])
  })

  test('length mode cuts hard at the limit', () => {
    expect(chunk('abcdefghij', 4, 'length')).toEqual(['abcd', 'efgh', 'ij'])
  })

  test('length mode keeps splitting until the remainder fits', () => {
    const parts = chunk('x'.repeat(25), 10, 'length')
    expect(parts).toEqual(['xxxxxxxxxx', 'xxxxxxxxxx', 'xxxxx'])
    expect(parts.join('')).toBe('x'.repeat(25))
  })

  test('newline mode prefers a paragraph boundary past the halfway point', () => {
    // limit 14 (half = 7); "\n\n" sits at index 10, past 7, so it wins.
    const parts = chunk('first para\n\nsecond bunch of words here', 14, 'newline')
    expect(parts[0]).toBe('first para')
    expect(parts[1]).toBe('second bunch')
    expect(parts[2]).toBe(' of words here')
  })

  test('newline mode falls back to a space; the space leads the next chunk', () => {
    // No newlines; last space at index 21 == limit, so the cut lands there and
    // server.ts only strips leading *newlines* from continuations, not spaces.
    expect(chunk('aaaaaaaaaa bbbbbbbbbb cc', 21, 'newline')).toEqual([
      'aaaaaaaaaa bbbbbbbbbb',
      ' cc',
    ])
  })

  test('newline mode hard-cuts when no boundary sits past the halfway point', () => {
    expect(chunk('abcdefghijabcdefghij', 10, 'newline')).toEqual(['abcdefghij', 'abcdefghij'])
  })

  test('leading newlines are stripped from continuation chunks (trailing ones are not)', () => {
    const parts = chunk('first line\n\n\n\nsecond chunk content here', 12, 'newline')
    expect(parts[0]).toBe('first line\n\n') // trailing \n\n on the first chunk is kept
    expect(parts.every(p => !p.startsWith('\n'))).toBe(true)
    expect(parts.slice(1).join('').includes('\n')).toBe(false)
  })
})

describe('constants', () => {
  test('MAX_CHUNK_LIMIT is Telegram’s hard cap', () => {
    expect(MAX_CHUNK_LIMIT).toBe(4096)
  })

  test('PHOTO_EXTS covers the inline-image extensions', () => {
    for (const ext of ['.jpg', '.jpeg', '.png', '.gif', '.webp']) {
      expect(PHOTO_EXTS.has(ext)).toBe(true)
    }
    expect(PHOTO_EXTS.has('.pdf')).toBe(false)
  })
})
