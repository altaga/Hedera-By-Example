// Regression tests for mirror_node_query / estimate_cost fixes (mocked Mirror Node, no network).
// Run: npx --yes tsx tests/06_mcp_service_fixes.test.ts
import assert from 'node:assert/strict'
import { dispatchOneMcp } from '../app/src/server/mcpService'

const calls: string[] = []
let mode = 'ok'
;(globalThis as any).fetch = async (url: string) => {
  calls.push(url)
  if (url.startsWith('https://us.i.posthog')) return new Response('{}')
  if (mode === 'timeout') { const e: any = new Error('t'); e.name = 'TimeoutError'; throw e }
  if (mode === '500') return new Response('boom', { status: 500 })
  if (url.includes('/accounts/0.0.99999999999')) return new Response('{"_status":{"messages":[{"message":"Not found"}]}}', { status: 404 })
  if (url.endsWith('/network/exchangerate')) return new Response(JSON.stringify({ current_rate: { cent_equivalent: 600, hbar_equivalent: 100 } })) // 1 HBAR = $0.06
  if (url.endsWith('/network/fees')) return new Response(mode === 'nofees' ? 'x' : JSON.stringify({ fees: [{ transaction_type: 'ContractCall', gas: 100 }, { transaction_type: 'ContractCreate', gas: 100 }] }), { status: mode === 'nofees' ? 503 : 200 })
  if (url.includes('/topics/0.0.5/messages')) return new Response(JSON.stringify({ messages: [], links: { next: '/api/v1/topics/0.0.5/messages?limit=2&timestamp=gt:1.2' } }))
  return new Response(JSON.stringify({ ok: true, links: { next: null } }))
}
const call = async (name: string, args: any) => (await dispatchOneMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result
const text = (r: any) => r.content[0].text
let n = 0
const t = async (label: string, fn: () => Promise<void>) => { await fn(); n++; console.log('ok', label) }

await t('tools/list still 10 tools', async () => {
  const r = (await dispatchOneMcp({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result
  assert.equal(r.tools.length, 10)
})
for (const bad of ['devnet', 'PREVIEWNET', 'Testnet', '', 5]) {
  await t(`mirror rejects network ${JSON.stringify(bad)}`, async () => {
    calls.length = 0
    const r = await call('mirror_node_query', { endpoint: 'network/nodes', network: bad })
    assert.equal(r.isError, true); assert.match(text(r), /network must be one of/)
    assert.equal(calls.filter((c) => c.includes('mirrornode')).length, 0)
  })
  await t(`estimate rejects network ${JSON.stringify(bad)}`, async () => {
    const r = await call('estimate_cost', { network: bad, operations: [{ type: 'hbar_transfer' }] })
    assert.equal(r.isError, true)
  })
}
await t('estimate rejects previewnet', async () => assert.equal((await call('estimate_cost', { network: 'previewnet', operations: [{ type: 'hbar_transfer' }] })).isError, true))
for (const net of ['testnet', 'mainnet', 'previewnet']) {
  await t(`mirror ${net} hits ${net} host`, async () => {
    calls.length = 0
    const r = await call('mirror_node_query', { endpoint: 'network/nodes', network: net })
    assert.notEqual(r.isError, true); assert.ok(calls[0].startsWith(`https://${net === "mainnet" ? "mainnet-public" : net}.mirrornode.hedera.com/`), calls[0])
  })
}
await t('upstream 404 -> isError', async () => {
  const r = await call('mirror_node_query', { endpoint: 'accounts', id: '0.0.99999999999' })
  assert.equal(r.isError, true); assert.match(text(r), /answered HTTP 404/)
})
await t('upstream 500 -> isError', async () => { mode = '500'; const r = await call('mirror_node_query', { endpoint: 'network/supply' }); mode = 'ok'; assert.equal(r.isError, true); assert.match(text(r), /HTTP 500/) })
await t('timeout -> isError', async () => { mode = 'timeout'; const r = await call('mirror_node_query', { endpoint: 'network/supply' }); mode = 'ok'; assert.equal(r.isError, true); assert.match(text(r), /timed out/) })
await t('estimate: rate failure is flagged', async () => { mode = '500'; const r = await call('estimate_cost', { operations: [{ type: 'hbar_transfer' }] }); mode = 'ok'; assert.match(text(r), /Exchange rate unavailable/) })
await t('pagination: next link exposed and followed', async () => {
  let r = await call('mirror_node_query', { endpoint: 'topics', id: '0.0.5', sub: 'messages', limit: 2 })
  assert.match(text(r), /next = "\/api\/v1\/topics\/0\.0\.5\/messages\?limit=2&timestamp=gt:1\.2"/)
  calls.length = 0
  r = await call('mirror_node_query', { endpoint: 'topics', id: '0.0.5', sub: 'messages', next: '/api/v1/topics/0.0.5/messages?limit=2&timestamp=gt:1.2' })
  assert.notEqual(r.isError, true); assert.equal(calls[0], 'https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.5/messages?limit=2&timestamp=gt:1.2')
})
for (const bad of ['https://evil.example/api/v1/topics/0.0.5/messages?a=1', '//evil.example/x', '/api/v1/accounts/0.0.1?limit=1', '/api/v1/topics/0.0.5/messages?a=1/../../x', '/api/v1/topics/0.0.5/messages?a=1#x', '/api/v1/topics/0.0.5/messages?a=b c', '/api/v1/topics/0.0.5/messages']) {
  await t(`pagination rejects ${bad}`, async () => {
    calls.length = 0
    const r = await call('mirror_node_query', { endpoint: 'topics', id: '0.0.5', sub: 'messages', next: bad })
    assert.equal(r.isError, true); assert.equal(calls.filter((c) => c.includes('mirrornode') || c.includes('evil')).length, 0)
  })
}
await t('limit out of range rejected', async () => assert.equal((await call('mirror_node_query', { endpoint: 'blocks', limit: 500 })).isError, true))
await t('token bundle arithmetic $3.101', async () => {
  const r = text(await call('estimate_cost', { operations: [{ type: 'token_create_custom_fees' }, { type: 'token_associate', count: 20 }, { type: 'token_mint_ft' }, { type: 'token_airdrop' }] }))
  assert.match(r, /\| \*\*Total\*\* \| \| \*\*\$3\.1010\*\* \| \*\*51\.6833 ℏ\*\* \|/)
})
await t('contract_call gas included in both totals, times count', async () => {
  // 100,000 gas * 100 tinybar * 2 calls = 0.2 HBAR = $0.012
  const r = text(await call('estimate_cost', { operations: [{ type: 'contract_call', count: 2, gas: 100000 }] }))
  assert.match(r, /\+ 0\.2000 ℏ gas \(\$0\.0120\)/)
  assert.match(r, /\| \*\*Total\*\* \| \| \*\*\$0\.0120\*\* \| \*\*0\.2000 ℏ\*\* \|/)
})
await t('contract_create fee + gas', async () => {
  const r = text(await call('estimate_cost', { operations: [{ type: 'contract_create', gas: 1000000 }] }))
  assert.match(r, /\*\*\$1\.0600\*\* \| \*\*17\.6667 ℏ\*\*/)
})
await t('missing gas -> total marked incomplete, not a silent zero', async () => {
  const r = text(await call('estimate_cost', { operations: [{ type: 'contract_call' }] }))
  assert.match(r, /Total \(incomplete: excludes gas/); assert.match(r, /gas not included/)
})
await t('gas price unavailable -> incomplete', async () => {
  mode = 'nofees'; const r = text(await call('estimate_cost', { operations: [{ type: 'contract_call', gas: 1000 }] })); mode = 'ok'
  assert.match(r, /incomplete/); assert.match(r, /gas price unavailable/)
})
for (const op of [{ type: 'contract_call', gas: 0 }, { type: 'contract_call', gas: 15000001 }, { type: 'hbar_transfer', gas: 10 }, { type: 'hbar_transfer', count: -1 }, { type: 'nope' }]) {
  await t(`estimate rejects ${JSON.stringify(op)}`, async () => assert.equal((await call('estimate_cost', { operations: [op] })).isError, true))
}
await t('HCS 100k messages + topic = $10.01', async () => {
  assert.match(text(await call('estimate_cost', { operations: [{ type: 'topic_create' }, { type: 'topic_message', count: 100000 }] })), /\*\*\$10\.0100\*\*/)
})
console.log(`\n${n} passed`)
