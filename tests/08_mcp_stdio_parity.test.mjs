// Stdio MCP regression + parity with the HTTP manifest. Spawns mcp/index.js with an offline fetch mock.
// Run: node tests/08_mcp_stdio_parity.test.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function startServer (mode = 'ok') {
  const p = spawn(process.execPath, ['--import', path.join(ROOT, 'tests/helpers/mock-mirror-fetch.mjs'), path.join(ROOT, 'mcp/index.js')], { env: { ...process.env, HBE_MOCK_MODE: mode }, stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = ''; const waiters = new Map(); const raw = []
  p.stdout.on('data', (d) => {
    buf += d; let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue
      raw.push(line)
      const msg = JSON.parse(line) // any non-JSON stdout line breaks the protocol -> throws
      waiters.get(msg.id)?.(msg); waiters.delete(msg.id)
    }
  })
  let id = 0
  const rpc = (method, params) => new Promise((res, rej) => { const n = ++id; const t = setTimeout(() => rej(new Error('timeout ' + method)), 15000); waiters.set(n, (m) => { clearTimeout(t); res(m) }); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n') })
  return { p, rpc, raw, call: async (name, args) => (await rpc('tools/call', { name, arguments: args })).result }
}
let n = 0
const t = async (label, fn) => { await fn(); n++; console.log('ok', label) }
const text = (r) => r.content[0].text

const s = startServer()
try {
  await t('initialize handshake', async () => {
    const r = await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    assert.equal(r.result.serverInfo.name.length > 0, true); assert.ok(r.result.capabilities.tools)
    s.p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  })
  await t('tools/list = 10 tools, identical to public HTTP manifest', async () => {
    const tools = (await s.rpc('tools/list')).result.tools
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/public/mcp/tools.json'), 'utf8')).tools
    assert.equal(tools.length, 10)
    assert.deepEqual(tools, manifest)
  })
  await t('prompts and resources listed', async () => {
    assert.ok((await s.rpc('prompts/list')).result.prompts.some((p) => p.name === 'review_hedera_code'))
    assert.ok((await s.rpc('resources/list')).result.resources.length > 100)
  })
  await t('guardrails updated (no 80% gas, 6,144 bytes, CHUNK_SIZE)', async () => {
    const g = text(await s.call('anti_hallucination_rules', {}))
    assert.doesNotMatch(g, /at least 80%/); assert.match(g, /6,144 bytes/); assert.match(g, /CHUNK_SIZE/); assert.match(g, /deprecated/)
  })
  for (const bad of ['devnet', 'PREVIEWNET', 'Testnet', 5]) {
    await t(`stdio mirror rejects ${JSON.stringify(bad)}`, async () => assert.equal((await s.call('mirror_node_query', { endpoint: 'network/nodes', network: bad })).isError, true))
    await t(`stdio estimate rejects ${JSON.stringify(bad)}`, async () => assert.equal((await s.call('estimate_cost', { network: bad, operations: [{ type: 'hbar_transfer' }] })).isError, true))
  }
  for (const [net, host] of [['testnet', 'testnet'], ['mainnet', 'mainnet-public'], ['previewnet', 'previewnet']]) {
    await t(`stdio ${net} host`, async () => assert.match(text(await s.call('mirror_node_query', { endpoint: 'network/nodes', network: net })), new RegExp(`https://${host}\\.mirrornode`)))
  }
  await t('stdio upstream 404 -> isError', async () => { const r = await s.call('mirror_node_query', { endpoint: 'accounts', id: '0.0.99999999999' }); assert.equal(r.isError, true); assert.match(text(r), /HTTP 404/) })
  await t('stdio pagination next + SSRF guard', async () => {
    assert.match(text(await s.call('mirror_node_query', { endpoint: 'topics', id: '0.0.5', sub: 'messages', limit: 2 })), /next = "\/api\/v1\/topics\/0\.0\.5\/messages/)
    const ok = await s.call('mirror_node_query', { endpoint: 'topics', id: '0.0.5', sub: 'messages', next: '/api/v1/topics/0.0.5/messages?limit=2&timestamp=gt:1.2' })
    assert.notEqual(ok.isError, true)
    assert.equal((await s.call('mirror_node_query', { endpoint: 'topics', id: '0.0.5', sub: 'messages', next: 'https://evil.example/api/v1/topics/0.0.5/messages?a=1' })).isError, true)
  })
  await t('stdio gas in totals x count', async () => assert.match(text(await s.call('estimate_cost', { operations: [{ type: 'contract_call', count: 2, gas: 100000 }] })), /\| \*\*Total\*\* \| \| \*\*\$0\.0120\*\* \| \*\*0\.2000 ℏ\*\* \|/))
  await t('stdio missing gas -> incomplete', async () => assert.match(text(await s.call('estimate_cost', { operations: [{ type: 'contract_call' }] })), /incomplete: excludes gas/))
  await t('stdio token bundle $3.101', async () => assert.match(text(await s.call('estimate_cost', { operations: [{ type: 'token_create_custom_fees' }, { type: 'token_associate', count: 20 }, { type: 'token_mint_ft' }, { type: 'token_airdrop' }] })), /\*\*\$3\.1010\*\*/))
  await t('stdio unknown tool -> JSON-RPC error', async () => assert.equal((await s.rpc('tools/call', { name: 'nope', arguments: {} })).error.code, -32602))
} finally { s.p.kill() }

for (const [mode, re] of [['500', /HTTP 500/], ['timeout', /timed out/]]) {
  const m = startServer(mode)
  try { await t(`stdio upstream ${mode} -> isError`, async () => { const r = await m.call('mirror_node_query', { endpoint: 'network/supply' }); assert.equal(r.isError, true); assert.match(text(r), re) }) } finally { m.p.kill() }
}
const nf = startServer('nofees')
try { await t('stdio gas price unavailable -> incomplete', async () => assert.match(text(await nf.call('estimate_cost', { operations: [{ type: 'contract_call', gas: 1000 }] })), /gas price unavailable/)) } finally { nf.p.kill() }
await t('every stdout line was valid JSON-RPC', async () => assert.ok(s.raw.every((l) => JSON.parse(l).jsonrpc === '2.0')))
console.log(`\n${n} passed`)
