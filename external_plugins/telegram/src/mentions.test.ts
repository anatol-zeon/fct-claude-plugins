import { describe, expect, test } from 'bun:test'
import { isMentioned, type IncomingMessage } from './mentions'

const BOT = 'mybot'

describe('isMentioned', () => {
  test('matches an @botusername mention entity (case-insensitive)', () => {
    const msg: IncomingMessage = {
      text: 'hey @MyBot can you help',
      entities: [{ type: 'mention', offset: 4, length: 6 }],
    }
    expect(isMentioned(msg, BOT)).toBe(true)
  })

  test('does not match a mention of someone else', () => {
    const msg: IncomingMessage = {
      text: 'hey @someoneelse look',
      entities: [{ type: 'mention', offset: 4, length: 12 }],
    }
    expect(isMentioned(msg, BOT)).toBe(false)
  })

  test('matches a text_mention entity pointing at the bot', () => {
    const msg: IncomingMessage = {
      text: 'ping the bot',
      entities: [{ type: 'text_mention', offset: 0, length: 4, user: { is_bot: true, username: BOT } }],
    }
    expect(isMentioned(msg, BOT)).toBe(true)
  })

  test('ignores a text_mention of a non-bot user with the same username', () => {
    const msg: IncomingMessage = {
      entities: [{ type: 'text_mention', offset: 0, length: 4, user: { is_bot: false, username: BOT } }],
    }
    expect(isMentioned(msg, BOT)).toBe(false)
  })

  test('a reply to one of the bot’s messages counts as a mention', () => {
    expect(isMentioned({ reply_to_message: { from: { username: BOT } } }, BOT)).toBe(true)
    expect(isMentioned({ reply_to_message: { from: { username: 'otherbot' } } }, BOT)).toBe(false)
  })

  test('uses caption / caption_entities when there is no text', () => {
    const msg: IncomingMessage = {
      caption: 'look @mybot',
      caption_entities: [{ type: 'mention', offset: 5, length: 6 }],
    }
    expect(isMentioned(msg, BOT)).toBe(true)
  })

  test('matches a configured mention pattern (case-insensitive regex)', () => {
    expect(isMentioned({ text: 'Hey Claude, status?' }, BOT, ['^hey claude\\b'])).toBe(true)
    expect(isMentioned({ text: 'unrelated' }, BOT, ['^hey claude\\b'])).toBe(false)
  })

  test('a broken user-supplied regex is skipped, not thrown', () => {
    expect(isMentioned({ text: 'anything' }, BOT, ['([unclosed'])).toBe(false)
  })

  test('plain message with no mention, no reply, no patterns → false', () => {
    expect(isMentioned({ text: 'just chatting' }, BOT)).toBe(false)
    expect(isMentioned({}, BOT)).toBe(false)
  })
})
