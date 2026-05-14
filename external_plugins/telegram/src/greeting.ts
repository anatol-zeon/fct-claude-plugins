// Boot greeting: what the bridge DMs allowlisted users when it comes online
// (fresh start, /newsession-driven respawn, systemd restart). The user
// asked for a visible "I'm alive" signal so they don't have to guess
// whether the bot is up after a reconnect.
//
// Format is intentionally two lines so the build line can be omitted in
// pieces when git info isn't available (e.g. the worktree was tarballed
// without .git, or we're running from a CC plugin cache that isn't a repo).

export type GreetingOpts = {
  botUsername: string
  branch: string  // empty string = unknown
  sha: string     // empty string = unknown
  pid: number
}

export function bootGreeting(opts: GreetingOpts): string {
  const head = `🟢 Bridge online — @${opts.botUsername}`
  const buildParts: string[] = []
  if (opts.branch && opts.sha) buildParts.push(`${opts.branch}@${opts.sha}`)
  else if (opts.sha) buildParts.push(opts.sha)
  else if (opts.branch) buildParts.push(opts.branch)
  buildParts.push(`pid ${opts.pid}`)
  return `${head}\n${buildParts.join(' · ')}`
}
