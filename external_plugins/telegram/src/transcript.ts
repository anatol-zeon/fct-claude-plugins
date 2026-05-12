// Reading the current session's transcript jsonl for the /context command.
//
// Claude Code logs each session to ~/.claude/projects/<cwd-encoded>/<session-id>.jsonl,
// one JSON line per turn. `assistant`-type entries carry `message.usage` with
// cache_read + cache_creation + input_tokens — the prompt size the model saw on
// that turn, which is effectively the current context usage. We tail the
// freshest such file under our cwd and report the most recent usage entry.

import { openSync, closeSync, readSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

export type ContextSnapshot = {
  inputTokens: number
  cacheRead: number
  cacheCreation: number
  outputTokens: number
  total: number
  model: string
}

/**
 * CC encodes the abs path by replacing `/` and `.` with `-` (the leading slash
 * becomes a leading dash). Matches the directory names under ~/.claude/projects/.
 */
export function projectDirHash(cwd: string): string {
  return cwd.replace(/[/.]/g, '-')
}

/** Newest `.jsonl` under `<projectsRoot>/<projectDirHash(cwd)>/`, or null. */
export function findSessionJsonl(projectsRoot: string, cwd: string): string | null {
  const dir = join(projectsRoot, projectDirHash(cwd))
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return null }
  const candidates = entries
    .filter(n => n.endsWith('.jsonl'))
    .map(n => {
      const p = join(dir, n)
      try { return { path: p, mtime: statSync(p).mtimeMs } } catch { return null }
    })
    .filter((x): x is { path: string; mtime: number } => x != null)
    .sort((a, b) => b.mtime - a.mtime)
  return candidates[0]?.path ?? null
}

/**
 * Read at most `maxBytes` from the end of the file so a long-lived session's
 * multi-MB jsonl doesn't make /context slow. 256KB easily covers several recent
 * turns; if even that's empty of assistant entries the session is fresh.
 */
export function readJsonlTail(path: string, maxBytes: number = 256 * 1024): string {
  const st = statSync(path)
  if (st.size <= maxBytes) return readFileSync(path, 'utf8')
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(maxBytes)
    readSync(fd, buf, 0, maxBytes, st.size - maxBytes)
    return buf.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** The most recent `assistant` turn's usage in a (possibly truncated) jsonl. */
export function parseLastUsage(text: string): ContextSnapshot | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    let entry: { type?: string; message?: { usage?: Record<string, unknown>; model?: string } }
    try { entry = JSON.parse(line) } catch { continue } // a tail can start mid-line
    if (entry?.type !== 'assistant') continue
    const usage = entry?.message?.usage
    if (!usage) continue
    const inputTokens = Number(usage.input_tokens ?? 0)
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0)
    const cacheCreation = Number(usage.cache_creation_input_tokens ?? 0)
    const outputTokens = Number(usage.output_tokens ?? 0)
    return {
      inputTokens, cacheRead, cacheCreation, outputTokens,
      total: inputTokens + cacheRead + cacheCreation,
      model: typeof entry.message?.model === 'string' ? entry.message.model : 'unknown',
    }
  }
  return null
}

export function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * The "fill" line for /context. Opus 4.x / Sonnet 4.x ship both 200k and 1M
 * variants and the loaded one isn't recoverable from the model string, so for
 * those families we show both percentages; older models show just 200k.
 */
export function fillLine(total: number, model: string): string {
  const isLargeFamily = /opus-4|sonnet-4/.test(model)
  const pct200 = (total / 200_000 * 100).toFixed(0)
  const pct1M = (total / 1_000_000 * 100).toFixed(0)
  return isLargeFamily ? `~${pct1M}% of 1M · ~${pct200}% of 200k` : `~${pct200}% of 200k`
}
