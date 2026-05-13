// In-process mock of api.telegram.org for e2e tests. The bridge subprocess
// runs with TELEGRAM_API_ROOT=http://localhost:<port> so grammy talks to this
// instead of Telegram. It accepts the bot API method calls we care about,
// records each one for later assertion, and serves a long-poll-style
// getUpdates that returns whatever the test pushed via `pushUpdate`.
//
// Any unhandled method returns the Telegram-canonical `{ ok: true, result: true }`
// so adding a new outbound call to server.ts doesn't break the mock — the test
// can still assert on the recorded request.

type AnyRecord = Record<string, unknown>

export type RecordedCall = {
  method: string
  body: AnyRecord
  at: number
}

export type TelegramMock = {
  url: string
  /** Push an update so the next getUpdates returns it. */
  pushUpdate(update: AnyRecord): void
  /** All recorded outbound bot-API calls, in order. */
  outbox(): RecordedCall[]
  /** Outbound calls of one method, in order. */
  outboxOf(method: string): RecordedCall[]
  /** Wait until `predicate` matches one of the recorded calls, or timeout. */
  waitFor(predicate: (c: RecordedCall) => boolean, timeoutMs?: number): Promise<RecordedCall>
  /** Reset state between scenarios. */
  reset(): void
  close(): Promise<void>
}

export async function startTelegramMock(opts: { botUsername?: string; botId?: number } = {}): Promise<TelegramMock> {
  const botUsername = opts.botUsername ?? 'mybot'
  const botId = opts.botId ?? 100001

  let nextUpdateId = 1
  let nextMessageId = 1
  let updateQueue: AnyRecord[] = []
  let waiters: Array<(updates: AnyRecord[]) => void> = []
  let calls: RecordedCall[] = []

  const drainQueueOrPark = (limit: number, longPollMs: number) =>
    new Promise<AnyRecord[]>(resolve => {
      if (updateQueue.length > 0) {
        const batch = updateQueue.splice(0, limit)
        resolve(batch)
        return
      }
      const timer = setTimeout(() => {
        waiters = waiters.filter(w => w !== onPush)
        resolve([])
      }, longPollMs)
      const onPush = (batch: AnyRecord[]) => {
        clearTimeout(timer)
        resolve(batch)
      }
      waiters.push(onPush)
    })

  // grammy stamps the message_id into sendMessage replies and chat metadata.
  // We just need enough shape for grammy not to throw — and so tests can read
  // the recorded request body directly.
  const fakeSentMessage = (body: AnyRecord) => ({
    message_id: nextMessageId++,
    date: Math.floor(Date.now() / 1000),
    chat: { id: Number(body.chat_id ?? 0), type: 'private' },
    from: { id: botId, is_bot: true, username: botUsername, first_name: 'mock' },
    text: typeof body.text === 'string' ? body.text : undefined,
  })

  const server = Bun.serve({
    port: 0, // OS-picked free port
    async fetch(req: Request) {
      const url = new URL(req.url)
      // Path: /bot<TOKEN>/<method>  — we don't validate the token; tests use any.
      const match = url.pathname.match(/^\/bot[^/]+\/(\w+)$/)
      if (!match) return new Response('not found', { status: 404 })
      const method = match[1]

      // Body can be JSON, form-encoded, or multipart (for file uploads). We
      // record JSON / form bodies; multipart we don't fully parse — tests that
      // hit photo/document downloads aren't in scope yet.
      let body: AnyRecord = {}
      const ct = req.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        body = (await req.json().catch(() => ({}))) as AnyRecord
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        const text = await req.text()
        body = Object.fromEntries(new URLSearchParams(text))
      } else if (req.method === 'GET') {
        body = Object.fromEntries(url.searchParams)
      }

      // Record everything except getUpdates (it's polled continuously — noise).
      if (method !== 'getUpdates') {
        calls.push({ method, body, at: Date.now() })
      }

      switch (method) {
        case 'getMe':
          return tgOk({ id: botId, is_bot: true, first_name: 'Mock', username: botUsername })

        case 'getUpdates': {
          const limit = Number(body.limit ?? 100)
          const longPollMs = Math.min(Number(body.timeout ?? 0) * 1000 || 50, 2000)
          const batch = await drainQueueOrPark(limit, longPollMs)
          return tgOk(batch)
        }

        case 'sendMessage':
        case 'sendPhoto':
        case 'sendDocument':
          return tgOk(fakeSentMessage(body))

        case 'editMessageText':
          return tgOk(fakeSentMessage(body))

        case 'setMessageReaction':
        case 'setMyCommands':
        case 'sendChatAction':
          return tgOk(true)

        default:
          // Unknown method — still return ok=true so the bridge doesn't crash.
          return tgOk(true)
      }
    },
  })

  const port = server.port
  const url = `http://localhost:${port}`

  function pushUpdate(update: AnyRecord): void {
    const stamped = { update_id: nextUpdateId++, ...update }
    if (waiters.length > 0) {
      const w = waiters.shift()!
      w([stamped])
    } else {
      updateQueue.push(stamped)
    }
  }

  function outbox(): RecordedCall[] {
    return [...calls]
  }
  function outboxOf(method: string): RecordedCall[] {
    return calls.filter(c => c.method === method)
  }

  async function waitFor(predicate: (c: RecordedCall) => boolean, timeoutMs = 3000): Promise<RecordedCall> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const hit = calls.find(predicate)
      if (hit) return hit
      await sleep(20)
    }
    throw new Error(
      `telegram-mock.waitFor timed out after ${timeoutMs}ms. ` +
      `Recorded calls so far: ${JSON.stringify(calls.map(c => ({ method: c.method, body: c.body })))}`,
    )
  }

  function reset(): void {
    calls = []
    updateQueue = []
    waiters = []
    nextUpdateId = 1
    nextMessageId = 1
  }

  async function close(): Promise<void> {
    server.stop(true)
  }

  return { url, pushUpdate, outbox, outboxOf, waitFor, reset, close }
}

function tgOk(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// Builders for the Telegram Update shapes the bridge consumes.

export function dmTextUpdate(senderId: number, text: string, opts: { username?: string; messageId?: number } = {}): AnyRecord {
  return {
    message: {
      message_id: opts.messageId ?? 1,
      date: Math.floor(Date.now() / 1000),
      from: { id: senderId, is_bot: false, first_name: 'User', username: opts.username },
      chat: { id: senderId, type: 'private', first_name: 'User', username: opts.username },
      text,
    },
  }
}

export function dmCommandUpdate(senderId: number, command: string): AnyRecord {
  // A bot command shows up as a message with a /command entity. grammy's
  // bot.command(...) matches on the entity, not the raw text.
  const text = command.startsWith('/') ? command : `/${command}`
  return {
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      from: { id: senderId, is_bot: false, first_name: 'User' },
      chat: { id: senderId, type: 'private', first_name: 'User' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
    },
  }
}
