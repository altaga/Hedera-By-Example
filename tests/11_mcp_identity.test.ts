// How the MCP server tells callers apart for analytics (no network: PostHog is mocked).
// Run: npx --yes tsx tests/11_mcp_identity.test.ts
import assert from 'node:assert/strict'
import { dispatchMcpRpc, type McpContext } from '../app/src/server/mcpService'
import { createSessionId, parseSessionId, identifyCaller } from '../app/src/server/mcpIdentity'

process.env.HOG_API_KEY = 'phc_test'
const events: any[] = []
;(globalThis as any).fetch = async (url: string, init?: any) => {
  if (url.startsWith('https://us.i.posthog')) events.push(JSON.parse(init.body))
  return new Response('{}')
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
let n = 0
const t = async (label: string, fn: () => Promise<void>) => { await fn(); n++; console.log('ok', label) }

const init = async (ctx: McpContext, clientInfo: any) => {
  await dispatchMcpRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo } }, ctx)
  await settle()
  return ctx.newSessionId as string
}
const callTool = async (ctx: McpContext) => {
  await dispatchMcpRpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_labs', arguments: {} } }, ctx)
  await settle()
  return events.at(-1)
}

await t('session id round-trips client name and version, visible ASCII only', async () => {
  const id = createSessionId({ name: 'claude-code', version: '2.1.0' })
  assert.match(id, /^[\x21-\x7e]+$/)
  const parsed = parseSessionId(id)
  assert.equal(parsed?.clientName, 'claude-code')
  assert.equal(parsed?.clientVersion, '2.1.0')
  assert.equal(parseSessionId('garbage'), null)
  assert.equal(parseSessionId('hbe1.not-base64!'), null)
})

await t('initialize issues a session and records hbe_mcp_session_started', async () => {
  events.length = 0
  const ctx: McpContext = { ip: '1.1.1.1', userAgent: 'node' }
  const id = await init(ctx, { name: 'cursor', version: '1.5' })
  assert.ok(id)
  assert.equal(events[0].event, 'hbe_mcp_session_started')
  assert.equal(events[0].properties.client_name, 'cursor')
  assert.equal(events[0].properties.id_source, 'session')
  assert.equal(events[0].distinct_id, `mcp:${parseSessionId(id)!.session}`)
})

await t('tool calls with the session header keep the same identity and client', async () => {
  const id = await init({ userAgent: 'node' }, { name: 'claude-code', version: '2.1.0' })
  const a = await callTool({ sessionId: id, userAgent: 'node' })
  const b = await callTool({ sessionId: id, userAgent: 'node' })
  assert.equal(a.event, 'hbe_mcp_tool_called')
  assert.equal(a.distinct_id, b.distinct_id)
  assert.equal(a.properties.client_name, 'claude-code')
  assert.equal(a.properties.client_version, '2.1.0')
  assert.equal(a.properties.client, 'claude-code')
})

await t('two connections from the same client program are two distinct callers', async () => {
  const id1 = await init({ userAgent: 'node' }, { name: 'claude-code', version: '2.1.0' })
  const id2 = await init({ userAgent: 'node' }, { name: 'claude-code', version: '2.1.0' })
  assert.notEqual((await callTool({ sessionId: id1 })).distinct_id, (await callTool({ sessionId: id2 })).distinct_id)
})

await t('clients without a session fall back to a daily hash that never contains the IP', async () => {
  const a = await callTool({ ip: '203.0.113.7', userAgent: 'curl/8' })
  const b = await callTool({ ip: '203.0.113.7', userAgent: 'curl/8' })
  const c = await callTool({ ip: '198.51.100.9', userAgent: 'curl/8' })
  assert.match(a.distinct_id, /^mcp-anon:[0-9a-f]{24}$/)
  assert.equal(a.distinct_id, b.distinct_id)
  assert.notEqual(a.distinct_id, c.distinct_id)
  assert.equal(a.properties.id_source, 'daily_hash')
  assert.ok(!JSON.stringify(a).includes('203.0.113.7'))
})

await t('a forged session header is ignored (falls back to the daily hash)', async () => {
  const caller = await identifyCaller({ sessionId: 'hbe1.' + Buffer.from('{"s":"zz"}').toString('base64url'), ip: '1.2.3.4', userAgent: 'x' })
  assert.equal(caller.idSource, 'daily_hash')
})

console.log(`\n${n} passed`)
