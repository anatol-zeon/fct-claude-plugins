import { describe, expect, test } from 'bun:test'
import { safeExt, safeId, safeName } from './sanitize'

describe('safeName', () => {
  test('passes plain names through unchanged', () => {
    expect(safeName('report.pdf')).toBe('report.pdf')
    expect(safeName('My Vacation Photo.jpg')).toBe('My Vacation Photo.jpg')
  })

  test('replaces characters that could break out of the <channel> tag', () => {
    expect(safeName('a<b>c[d]e\r\nf;g')).toBe('a_b_c_d_e__f_g')
  })

  test('returns undefined for undefined input', () => {
    expect(safeName(undefined)).toBeUndefined()
  })

  test('an empty string stays an empty string (not undefined)', () => {
    expect(safeName('')).toBe('')
  })
})

describe('safeExt', () => {
  test('extracts and lowercases-friendly the extension', () => {
    expect(safeExt('photos/file.JPG')).toBe('JPG')
    expect(safeExt('a/b/c.tar.gz')).toBe('gz')
  })

  test('strips anything non-alphanumeric from the extension', () => {
    expect(safeExt('weird.p<n>g')).toBe('png')
  })

  test('falls back when there is no extension', () => {
    expect(safeExt('noext')).toBe('bin')
    expect(safeExt('trailingdot.')).toBe('bin')
    expect(safeExt('photo', 'jpg')).toBe('jpg')
  })

  test('honours a custom fallback', () => {
    expect(safeExt('whatever', 'jpg')).toBe('jpg')
  })
})

describe('safeId', () => {
  test('keeps alphanumerics, dashes and underscores', () => {
    expect(safeId('AbC_12-xyz')).toBe('AbC_12-xyz')
  })

  test('strips everything else', () => {
    expect(safeId('a/b\\c.d e')).toBe('abcde')
  })

  test('falls back for empty / missing input', () => {
    expect(safeId('')).toBe('dl')
    expect(safeId(undefined)).toBe('dl')
    expect(safeId('!!!', 'x')).toBe('x')
  })
})
