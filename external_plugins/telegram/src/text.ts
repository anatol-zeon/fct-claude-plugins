// Outbound text helpers: Telegram caps a single message at 4096 chars, so long
// replies get split — preferring paragraph/line/space boundaries in 'newline'
// mode, hard-cutting at the limit in 'length' mode.

/** Telegram's hard per-message character cap. */
export const MAX_CHUNK_LIMIT = 4096

/**
 * .jpg/.jpeg/.png/.gif/.webp send as photos (Telegram compresses + shows
 * inline); everything else sends as a document (raw file, no compression).
 */
export const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])

export function chunk(text: string, limit: number, mode: 'length' | 'newline'): string[] {
  if (text.length <= limit) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = limit
    if (mode === 'newline') {
      // Prefer the last double-newline (paragraph), then single newline, then
      // space. Fall back to a hard cut.
      const para = rest.lastIndexOf('\n\n', limit)
      const line = rest.lastIndexOf('\n', limit)
      const space = rest.lastIndexOf(' ', limit)
      cut = para > limit / 2 ? para : line > limit / 2 ? line : space > 0 ? space : limit
    }
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest) out.push(rest)
  return out
}
