import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  fillLine,
  findSessionJsonl,
  fmtNum,
  parseLastUsage,
  projectDirHash,
  readJsonlTail,
} from './transcript'

describe('projectDirHash', () => {
  test('encodes an absolute path the way ~/.claude/projects/ does', () => {
    expect(projectDirHash('/home/dex/projects/fct-tg-bot')).toBe('-home-dex-projects-fct-tg-bot')
  })

  test('replaces dots too', () => {
    expect(projectDirHash('/a/b.c/d')).toBe('-a-b-c-d')
  })
})

describe('fmtNum', () => {
  test('groups thousands with US separators', () => {
    expect(fmtNum(0)).toBe('0')
    expect(fmtNum(12345)).toBe('12,345')
    expect(fmtNum(1000000)).toBe('1,000,000')
  })
})

describe('parseLastUsage', () => {
  const assistantLine = (usage: Record<string, number>, model = 'claude-opus-4-7') =>
    JSON.stringify({ type: 'assistant', message: { model, usage } })

  test('returns null when there are no assistant entries', () => {
    expect(parseLastUsage('')).toBeNull()
    expect(parseLastUsage(JSON.stringify({ type: 'user', message: { content: 'hi' } }))).toBeNull()
  })

  test('reads usage from the last assistant entry', () => {
    const text = [
      assistantLine({ input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, output_tokens: 4 }),
      JSON.stringify({ type: 'user', message: {} }),
      assistantLine({ input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 40 }, 'claude-sonnet-4-6'),
    ].join('\n')
    expect(parseLastUsage(text)).toEqual({
      inputTokens: 10,
      cacheRead: 20,
      cacheCreation: 30,
      outputTokens: 40,
      total: 60, // input + cache_read + cache_creation (output excluded)
      model: 'claude-sonnet-4-6',
    })
  })

  test('treats missing usage fields as zero', () => {
    expect(parseLastUsage(assistantLine({ input_tokens: 5 }))).toEqual({
      inputTokens: 5,
      cacheRead: 0,
      cacheCreation: 0,
      outputTokens: 0,
      total: 5,
      model: 'claude-opus-4-7',
    })
  })

  test('skips blank and partial (mid-line) JSON without throwing', () => {
    const text = '\n{ this is not json\n' + assistantLine({ input_tokens: 7 }) + '\n   \n'
    expect(parseLastUsage(text)?.inputTokens).toBe(7)
  })

  test('falls back to "unknown" model when the field is absent', () => {
    expect(parseLastUsage(JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1 } } }))?.model).toBe('unknown')
  })
})

describe('fillLine', () => {
  test('shows both 1M and 200k figures for the large-context families', () => {
    expect(fillLine(100_000, 'claude-opus-4-7')).toBe('~10% of 1M · ~50% of 200k')
    expect(fillLine(100_000, 'claude-sonnet-4-6')).toBe('~10% of 1M · ~50% of 200k')
  })

  test('shows only the 200k figure for other models', () => {
    expect(fillLine(50_000, 'claude-3-5-haiku')).toBe('~25% of 200k')
  })
})

describe('readJsonlTail / findSessionJsonl (fs)', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tg-transcript-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('readJsonlTail returns the whole file when small', () => {
    const p = join(root, 'small.jsonl')
    writeFileSync(p, 'line one\nline two\n')
    expect(readJsonlTail(p)).toBe('line one\nline two\n')
  })

  test('readJsonlTail returns only the tail when the file is larger than maxBytes', () => {
    const p = join(root, 'big.jsonl')
    writeFileSync(p, 'A'.repeat(1000) + 'TAILMARK')
    const out = readJsonlTail(p, 16)
    expect(out.length).toBe(16)
    expect(out.endsWith('TAILMARK')).toBe(true)
  })

  test('findSessionJsonl picks the newest .jsonl under projects/<hash>/', () => {
    const cwd = '/some/where'
    const dir = join(root, projectDirHash(cwd))
    mkdirSync(dir, { recursive: true })
    const older = join(dir, 'older.jsonl')
    const newer = join(dir, 'newer.jsonl')
    writeFileSync(older, 'x')
    writeFileSync(newer, 'y')
    const future = Date.now() / 1000 + 60
    require('fs').utimesSync(newer, future, future)
    writeFileSync(join(dir, 'not-a-transcript.txt'), 'z')
    expect(findSessionJsonl(root, cwd)).toBe(newer)
  })

  test('findSessionJsonl returns null when the project dir is absent', () => {
    expect(findSessionJsonl(root, '/no/such/project')).toBeNull()
  })
})
