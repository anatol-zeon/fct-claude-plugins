// Harness for end-to-end tests: spawns `bun server.ts` as a subprocess with
// TELEGRAM_API_ROOT pointed at the telegram-mock, attaches a minimal
// line-delimited-JSON MCP client to its stdio, and exposes the things a test
// actually needs (push a Telegram update, wait for an MCP notification, send
// a notification to the bridge, see what the bridge said to "Telegram").

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { spawn, type Subprocess } from 'bun'
import { startTelegramMock, type TelegramMock } from './telegram-mock'

type JsonRpcMessage = {
  jsonrpc: '2.0'
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

export type McpNotification = { method: string; params: unknown; at: number }

export type Bridge = {
  mock: TelegramMock
  stateDir: string
  /** Send an MCP notification to the bridge. */
  sendNotification(method: string, params: unknown): void
  /** Block until a notification matching `predicate` arrives, or time out. */
  waitForNotification(
    method: string,
    predicate?: (n: McpNotification) => boolean,
    timeoutMs?: number,
  ): Promise<McpNotification>
  /** All received notifications, in order. */
  notifications(): McpNotification[]
  stop(): Promise<void>
}

export type StartBridgeOpts = {
  /** Pre-populated access.json contents. Omitted = default (pairing, empty allowFrom). */
  access?: Record<string, unknown>
  /** Pre-create approved/<senderId> files (chat-id contents); the bridge polls this dir. */
  approved?: Record<string, string>
  /** Override env. */
  env?: Record<string, string>
}

export async function startBridge(opts: StartBridgeOpts = {}): Promise<Bridge> {
  const mock = await startTelegramMock()
  const stateDir = makeStateDir(opts)
  const proc = spawnBridge(mock.url, stateDir, opts.env)
  const mcp = await attachMcp(proc)
  await mcp.initialize()
  // Bridge advertises an idle/wakeup line on stderr; wait until grammy's
  // onStart fires (it triggers setMyCommands) so we know polling is up.
  await mock.waitFor(c => c.method === 'setMyCommands', 5000)

  return {
    mock,
    stateDir,
    sendNotification: (method, params) => mcp.send({ jsonrpc: '2.0', method, params }),
    waitForNotification: (method, predicate, timeoutMs = 3000) =>
      mcp.waitForNotification(method, predicate, timeoutMs),
    notifications: () => mcp.notifications(),
    async stop() {
      mcp.close()
      proc.kill('SIGTERM')
      try {
        await Promise.race([
          (proc.exited as Promise<number>),
          new Promise(r => setTimeout(r, 1500)),
        ])
      } finally {
        if (!proc.killed) proc.kill('SIGKILL')
      }
      await mock.close()
    },
  }
}

// ── subprocess + state dir ───────────────────────────────────────────────────

function makeStateDir(opts: StartBridgeOpts): string {
  const dir = join('/tmp', `tg-e2e-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (opts.access) {
    writeFileSync(join(dir, 'access.json'), JSON.stringify(opts.access, null, 2), { mode: 0o600 })
  }
  if (opts.approved) {
    const approvedDir = join(dir, 'approved')
    mkdirSync(approvedDir, { recursive: true })
    for (const [senderId, chatId] of Object.entries(opts.approved)) {
      writeFileSync(join(approvedDir, senderId), chatId)
    }
  }
  return dir
}

function spawnBridge(apiRoot: string, stateDir: string, extraEnv?: Record<string, string>): Subprocess {
  // server.ts is in the plugin root. bun test runs with cwd = plugin root.
  return spawn(['bun', 'server.ts'], {
    cwd: process.cwd(),
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore', // flip to 'inherit' to debug
    env: {
      ...process.env,
      TELEGRAM_BRIDGE: '1',
      TELEGRAM_BOT_TOKEN: 'e2e-test-token',
      TELEGRAM_API_ROOT: apiRoot,
      TELEGRAM_STATE_DIR: stateDir,
      ...extraEnv,
    },
  })
}

// ── stdio MCP client (line-delimited JSON-RPC 2.0) ───────────────────────────

type McpClient = {
  initialize(): Promise<void>
  send(msg: JsonRpcMessage): void
  notifications(): McpNotification[]
  waitForNotification(
    method: string,
    predicate?: (n: McpNotification) => boolean,
    timeoutMs?: number,
  ): Promise<McpNotification>
  close(): void
}

async function attachMcp(proc: Subprocess): Promise<McpClient> {
  const notifs: McpNotification[] = []
  const pending = new Map<number | string, (msg: JsonRpcMessage) => void>()
  let nextId = 1
  let closed = false
  const stdinSink = proc.stdin as { write: (s: string) => unknown; flush?: () => unknown }
  const stdout = proc.stdout as ReadableStream<Uint8Array>
  const reader = stdout.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  void (async () => {
    while (!closed) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true } as const))
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let msg: JsonRpcMessage
        try {
          msg = JSON.parse(line) as JsonRpcMessage
        } catch { continue }
        if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
          const cb = pending.get(msg.id)
          if (cb) {
            pending.delete(msg.id)
            cb(msg)
          }
          continue
        }
        if (typeof msg.method === 'string') {
          notifs.push({ method: msg.method, params: msg.params, at: Date.now() })
        }
      }
    }
  })()

  function send(msg: JsonRpcMessage): void {
    stdinSink.write(JSON.stringify(msg) + '\n')
    stdinSink.flush?.()
  }

  function request<T>(method: string, params: unknown, timeoutMs = 5000): Promise<T> {
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      pending.set(id, msg => {
        clearTimeout(timer)
        if (msg.error) reject(new Error(`MCP ${method} error: ${msg.error.message}`))
        else resolve(msg.result as T)
      })
      send({ jsonrpc: '2.0', id, method, params })
    })
  }

  async function initialize(): Promise<void> {
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'fct-tg-bot e2e harness', version: '0' },
    })
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }

  async function waitForNotification(
    method: string,
    predicate?: (n: McpNotification) => boolean,
    timeoutMs = 3000,
  ): Promise<McpNotification> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const hit = notifs.find(n => n.method === method && (!predicate || predicate(n)))
      if (hit) return hit
      await new Promise(r => setTimeout(r, 20))
    }
    throw new Error(
      `MCP notification "${method}" not received within ${timeoutMs}ms. ` +
      `Seen: ${JSON.stringify(notifs.map(n => n.method))}`,
    )
  }

  return {
    initialize,
    send,
    notifications: () => [...notifs],
    waitForNotification,
    close: () => {
      closed = true
      try { void reader.cancel() } catch {}
    },
  }
}
