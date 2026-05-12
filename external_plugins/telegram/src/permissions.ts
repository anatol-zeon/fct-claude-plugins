// Permission-reply parsing for the channel permission-relay
// (anthropics/claude-cli-internal: notifications/claude/channel/permission).
//
// When CC asks the operator to approve a tool call, the server DMs a prompt and
// the operator replies in chat. The reply spec (inlined from
// src/services/mcp/channelPermissions.ts so there's no CC repo dependency):
// `y|yes|n|no` then whitespace then a 5-letter request id drawn from a-z minus
// 'l'. Case-insensitive so phone autocorrect doesn't break it. Strict: no bare
// yes/no (too conversational), no prefix/suffix chatter.

export const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

export type PermissionReply = { requestId: string; behavior: 'allow' | 'deny' }

/** Parse a chat message as a permission reply, or return null if it isn't one. */
export function matchPermissionReply(text: string): PermissionReply | null {
  const m = text.match(PERMISSION_REPLY_RE)
  if (!m) return null
  return {
    requestId: m[2]!.toLowerCase(),
    behavior: m[1]!.toLowerCase().startsWith('y') ? 'allow' : 'deny',
  }
}
