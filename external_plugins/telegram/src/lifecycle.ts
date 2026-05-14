// Helpers for the bridge's lifecycle hooks. Currently: walking the parent
// chain to find a specific ancestor — needed by /newsession, which has to
// SIGTERM the *claude* process, not its immediate parent. server.ts is run
// under `bun run --cwd … start`, so `process.ppid` points at the bun-run
// wrapper, not at claude; signalling the wrapper just kills the MCP server
// (us) and leaves claude untouched.

/**
 * Walk the parent chain from `startPid` upward and return the first PID for
 * which `matches` is true. `readPpid` returns the parent PID for a given PID,
 * or `null`/`undefined` if unknown (e.g. orphan, sandboxed, or non-Linux
 * platform where /proc doesn't exist).
 *
 * Refuses to consider PID 0 or 1 (init) — sending SIGTERM to init would be a
 * very bad day. Capped at `maxDepth` (default 20) to avoid pathological loops
 * if /proc reports a self-cycle or anything weird.
 */
export function findAncestorPid(
  startPid: number,
  matches: (pid: number) => boolean,
  readPpid: (pid: number) => number | null | undefined,
  maxDepth: number = 20,
): number | null {
  let cur = startPid
  for (let i = 0; i < maxDepth; i++) {
    if (cur <= 1) return null
    if (matches(cur)) return cur
    const parent = readPpid(cur)
    if (parent == null) return null
    cur = parent
  }
  return null
}
