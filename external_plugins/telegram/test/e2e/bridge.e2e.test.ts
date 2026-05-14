// End-to-end: spawn the real bun server.ts bridge, talk to it from one side
// over MCP stdio and from the other side over a fake Telegram API. Verifies
// the IO/wiring layer of server.ts that the src/ unit tests can't see.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'fs'
import { startBridge, type Bridge } from './bridge-harness'
import { dmCommandUpdate, dmTextUpdate } from './telegram-mock'

const OWNER_ID = 555
const SCENARIO_TIMEOUT = 15_000

let bridge: Bridge | null = null

afterEach(async () => {
  if (bridge) {
    const dir = bridge.stateDir
    await bridge.stop()
    bridge = null
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
})

describe('bridge e2e', () => {
  test('unpaired DM gets a pairing code; no MCP notification is emitted', async () => {
    bridge = await startBridge({ access: { dmPolicy: 'pairing', allowFrom: [], groups: {}, pending: {} } })

    bridge.mock.pushUpdate(dmTextUpdate(9001, 'hello bot'))

    const sent = await bridge.mock.waitFor(
      c => c.method === 'sendMessage' && String(c.body.chat_id) === '9001',
    )
    expect(String(sent.body.text)).toContain('Pairing required')
    expect(String(sent.body.text)).toMatch(/\/telegram:access pair [0-9a-f]{6}/)

    // Bridge must NOT have relayed the message — paired-not-delivered.
    await sleep(200)
    expect(bridge.notifications().find(n => n.method === 'notifications/claude/channel')).toBeUndefined()
  }, SCENARIO_TIMEOUT)

  test('allowlisted DM is delivered to MCP with chat_id, user_id, ts meta', async () => {
    bridge = await startBridge({
      access: { dmPolicy: 'allowlist', allowFrom: [String(OWNER_ID)], groups: {}, pending: {} },
    })

    bridge.mock.pushUpdate(dmTextUpdate(OWNER_ID, 'ping', { username: 'owner', messageId: 42 }))

    const notif = await bridge.waitForNotification('notifications/claude/channel')
    const params = notif.params as { content: string; meta: Record<string, string> }
    expect(params.content).toBe('ping')
    expect(params.meta.chat_id).toBe(String(OWNER_ID))
    expect(params.meta.user_id).toBe(String(OWNER_ID))
    expect(params.meta.message_id).toBe('42')
    expect(params.meta.user).toBe('owner')

    // And we should have fired a typing indicator on the way in.
    expect(bridge.mock.outboxOf('sendChatAction').length).toBeGreaterThan(0)
  }, SCENARIO_TIMEOUT)

  test('permission-relay: request → DM → "y <id>" reply → MCP permission notification', async () => {
    bridge = await startBridge({
      access: { dmPolicy: 'allowlist', allowFrom: [String(OWNER_ID)], groups: {}, pending: {} },
    })

    bridge.sendNotification('notifications/claude/channel/permission_request', {
      request_id: 'abcde',
      tool_name: 'Bash',
      description: 'List the current directory',
      input_preview: '{"command":"ls"}',
    })

    const dm = await bridge.mock.waitFor(
      c => c.method === 'sendMessage' &&
           String(c.body.chat_id) === String(OWNER_ID) &&
           String(c.body.text).includes('🔐 Permission [abcde]'),
    )
    expect(String(dm.body.text)).toContain('Bash')
    expect(String(dm.body.text)).toContain('Reply: y abcde to allow')

    // Operator replies "y abcde" from Telegram. The bridge must NOT relay this
    // as a regular channel message — it's intercepted by the permission gate.
    bridge.mock.pushUpdate(dmTextUpdate(OWNER_ID, 'y abcde', { messageId: 77 }))

    const permNotif = await bridge.waitForNotification('notifications/claude/channel/permission')
    expect(permNotif.params).toEqual({ request_id: 'abcde', behavior: 'allow' })

    // ✅ reaction on the reply message. The body shape grammy sends is
    // { chat_id, message_id, reaction: [{ type: 'emoji', emoji: '✅' }] }
    // — JSON-encoded into the body. We stringify and check the emoji is in there.
    const react = await bridge.mock.waitFor(
      c => c.method === 'setMessageReaction' && String(c.body.message_id) === '77',
    )
    expect(JSON.stringify(react.body.reaction)).toContain('✅')

    // Crucially: no plain-text channel relay of "y abcde".
    expect(
      bridge.notifications().find(
        n => n.method === 'notifications/claude/channel' &&
             (n.params as { content?: string }).content === 'y abcde',
      ),
    ).toBeUndefined()
  }, SCENARIO_TIMEOUT)

  test('/status DM from an allowlisted user replies "Paired as ..."', async () => {
    bridge = await startBridge({
      access: { dmPolicy: 'allowlist', allowFrom: [String(OWNER_ID)], groups: {}, pending: {} },
    })

    bridge.mock.pushUpdate(dmCommandUpdate(OWNER_ID, '/status'))

    // Predicate explicitly anchors on "Paired as " so the boot-greeting
    // sendMessage (which also targets allowlisted chat_ids on startup) doesn't
    // get returned ahead of the /status reply.
    const reply = await bridge.mock.waitFor(
      c => c.method === 'sendMessage' &&
           String(c.body.chat_id) === String(OWNER_ID) &&
           String(c.body.text).startsWith('Paired as '),
    )
    expect(String(reply.body.text)).toMatch(/Paired as /)
  }, SCENARIO_TIMEOUT)

  test('boot greeting is DM\'d to every allowlisted user on startup', async () => {
    bridge = await startBridge({
      access: { dmPolicy: 'allowlist', allowFrom: [String(OWNER_ID)], groups: {}, pending: {} },
    })

    const greeting = await bridge.mock.waitFor(
      c => c.method === 'sendMessage' &&
           String(c.body.chat_id) === String(OWNER_ID) &&
           String(c.body.text).startsWith('🟢 Bridge online'),
    )
    expect(String(greeting.body.text)).toContain('Bridge online')
    expect(String(greeting.body.text)).toContain(`pid `)
  }, SCENARIO_TIMEOUT)

  test('no greeting goes out when the allowlist is empty', async () => {
    bridge = await startBridge({
      access: { dmPolicy: 'pairing', allowFrom: [], groups: {}, pending: {} },
    })

    // Give grammy a moment to fire onStart fully — setMyCommands has already
    // hit the mock (the harness waited for that), and the greeting would
    // ride right after if it were going to.
    await sleep(300)
    const greetings = bridge.mock.outboxOf('sendMessage').filter(
      c => String(c.body.text).startsWith('🟢 Bridge online'),
    )
    expect(greetings.length).toBe(0)
  }, SCENARIO_TIMEOUT)
})

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
