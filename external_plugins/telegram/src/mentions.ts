// Mention detection for group chats with requireMention. The bot responds when
// it's @mentioned (structured entity), replied to, or the message matches one
// of the operator-configured regex patterns.

/** The slice of a Telegram message this needs — grammy's Message is compatible. */
export type IncomingMessage = {
  text?: string
  caption?: string
  entities?: MessageEntity[]
  caption_entities?: MessageEntity[]
  reply_to_message?: { from?: { username?: string } }
}

type MessageEntity = {
  type: string
  offset: number
  length: number
  user?: { is_bot?: boolean; username?: string }
}

export function isMentioned(
  msg: IncomingMessage,
  botUsername: string,
  extraPatterns?: string[],
): boolean {
  const entities = msg.entities ?? msg.caption_entities ?? []
  const text = msg.text ?? msg.caption ?? ''
  for (const e of entities) {
    if (e.type === 'mention') {
      const mentioned = text.slice(e.offset, e.offset + e.length)
      if (mentioned.toLowerCase() === `@${botUsername}`.toLowerCase()) return true
    }
    if (e.type === 'text_mention' && e.user?.is_bot && e.user.username === botUsername) {
      return true
    }
  }

  // A reply to one of our messages counts as an implicit mention.
  if (msg.reply_to_message?.from?.username === botUsername) return true

  for (const pat of extraPatterns ?? []) {
    try {
      if (new RegExp(pat, 'i').test(text)) return true
    } catch {
      // Invalid operator-supplied regex — skip it.
    }
  }
  return false
}
