// Sanitizers for uploader- and Telegram-controlled strings before they enter
// either the <channel> notification block (delimiter injection) or a local
// filesystem path (path/extension surprises).

/**
 * Filenames, titles, etc. land inside the <channel> notification — these chars
 * would let the uploader break out of the tag or forge a second meta entry.
 * undefined in → undefined out (callers omit the field entirely in that case).
 */
export function safeName(s: string | undefined): string | undefined {
  return s?.replace(/[<>\[\]\r\n;]/g, '_')
}

/**
 * Pull a filesystem-safe extension out of a path/filename. Strips anything
 * non-alphanumeric; falls back (default 'bin') when there's no usable suffix.
 */
export function safeExt(filePath: string, fallback = 'bin'): string {
  const raw = filePath.includes('.') ? filePath.split('.').pop()! : ''
  return raw.replace(/[^a-zA-Z0-9]/g, '') || fallback
}

/** Sanitize an opaque id (Telegram file_unique_id) for use in a filename. */
export function safeId(s: string | undefined, fallback = 'dl'): string {
  return (s ?? '').replace(/[^a-zA-Z0-9_-]/g, '') || fallback
}
