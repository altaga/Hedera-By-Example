/**
 * ============================================================================
 * TEST SUITE 05: Universal Model Context Protocol (MCP) Server Audit
 * ============================================================================
 * Validates JSON-RPC 2.0 compliance, stdio IPC, and HTTP/SSE transports.
 * ============================================================================
 */
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

const MCP_ENTRY = path.join(ROOT, 'mcp', 'index.js')

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function runMcpServerTest() {
  console.log('\n================================================================')
  console.log('🧪 TEST 05: UNIVERSAL MODEL CONTEXT PROTOCOL (MCP) SERVER AUDIT')
  console.log(`📡 Target: ${MCP_ENTRY}`)
  console.log('================================================================')

  // --------------------------------------------------------------------------
  // PART 1: STDIO TRANSPORT AUDIT (JSON-RPC 2.0)
  // --------------------------------------------------------------------------
  console.log('  [PART 1] Testing stdio JSON-RPC 2.0 handshake...')

  const stdioProc = spawn('node', [MCP_ENTRY], {
    stdio: ['pipe', 'pipe', 'pipe']
  })

  let stdioOut = ''
  stdioProc.stdout.on('data', chunk => {
    stdioOut += chunk.toString()
  })

  const sendStdio = (payload) => {
    stdioProc.stdin.write(JSON.stringify(payload) + '\n')
  }

  // 1. Initialize
  sendStdio({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test-harness', version: '1.0.0' }
    }
  })

  await delay(400)
  const initResp = stdioOut.split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l) } catch (_) { return null }
  }).find(j => j && j.id === 1)

  if (!initResp || !initResp.result?.serverInfo?.name) {
    stdioProc.kill()
    throw new Error(`Failed to initialize MCP over stdio: received ${stdioOut}`)
  }
  console.log(`  ✓ stdio Initialize: server="${initResp.result.serverInfo.name}" protocol="${initResp.result.protocolVersion}"`)

  // 2. tools/list
  sendStdio({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  await delay(400)
  const listResp = stdioOut.split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l) } catch (_) { return null }
  }).find(j => j && j.id === 2)

  const tools = listResp?.result?.tools || []
  if (tools.length < 6) {
    stdioProc.kill()
    throw new Error(`Expected at least 6 tools, received ${tools.length}`)
  }
  console.log(`  ✓ stdio tools/list: ${tools.length} tools registered (${tools.map(t => t.name).join(', ')})`)

  // 3. tools/call -> anti_hallucination_rules
  sendStdio({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'anti_hallucination_rules', arguments: {} }
  })
  await delay(400)
  const rulesResp = stdioOut.split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l) } catch (_) { return null }
  }).find(j => j && j.id === 3)

  const rulesText = rulesResp?.result?.content?.[0]?.text || ''
  if (!rulesText.includes('100,000,000 tinybars') || !rulesText.includes('8 decimals')) {
    stdioProc.kill()
    throw new Error(`anti_hallucination_rules validation failed: ${rulesText}`)
  }
  console.log('  ✓ stdio tools/call (anti_hallucination_rules): verified 8 decimal precision rule.')

  // 4. tools/call -> query_curriculum
  sendStdio({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'query_curriculum', arguments: { query: 'generate_wallet', lang: 'en' } }
  })
  await delay(400)
  const currResp = stdioOut.split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l) } catch (_) { return null }
  }).find(j => j && j.id === 4)

  const currText = currResp?.result?.content?.[0]?.text || ''
  if (!currText.includes('PrivateKey.generateECDSA()')) {
    stdioProc.kill()
    throw new Error(`query_curriculum validation failed: ${currText}`)
  }
  console.log('  ✓ stdio tools/call (query_curriculum): returned runnable Lab 01 code successfully.')

  stdioProc.kill()
  console.log('  ✓ stdio transport teardown clean.')

  // --------------------------------------------------------------------------
  // PART 2: HTTP & SSE TRANSPORT AUDIT
  // --------------------------------------------------------------------------
  const TEST_PORT = 3189
  console.log(`\n  [PART 2] Testing HTTP transport on port ${TEST_PORT}...`)

  const httpProc = spawn('node', [MCP_ENTRY, '--http', String(TEST_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe']
  })

  await delay(800)

  try {
    // 1. GET /health
    const healthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/health`)
    const healthJson = await healthRes.json()
    if (healthJson.status !== 'online') {
      throw new Error(`HTTP /health check failed: ${JSON.stringify(healthJson)}`)
    }
    console.log(`  ✓ HTTP /health check: status="${healthJson.status}" version="${healthJson.version}"`)

    // 2. GET /tools
    const toolsRes = await fetch(`http://127.0.0.1:${TEST_PORT}/tools`)
    const toolsJson = await toolsRes.json()
    if (!toolsJson.tools || toolsJson.tools.length < 6) {
      throw new Error(`HTTP /tools failed: ${JSON.stringify(toolsJson)}`)
    }
    console.log(`  ✓ HTTP /tools endpoint: ${toolsJson.tools.length} tools available over HTTP`)

    // 3. POST /mcp (JSON-RPC)
    const mcpRes = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'query_knowledge',
          arguments: { query: 'x402' }
        }
      })
    })
    const mcpJson = await mcpRes.json()
    const mcpText = mcpJson?.result?.content?.[0]?.text || ''
    if (!mcpText.includes('x402 Micropayments Protocol')) {
      throw new Error(`HTTP POST /mcp failed: ${JSON.stringify(mcpJson)}`)
    }
    console.log('  ✓ HTTP POST /mcp: JSON-RPC tool call executed and returned knowledge graph.')

    // 4. Streamable HTTP details: notifications get 202, GET /mcp is not a stream, foreign Origins are refused
    const note = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    if (note.status !== 202) throw new Error(`Notification should get 202, got ${note.status}`)
    const getMcp = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`)
    if (getMcp.status !== 405) throw new Error(`GET /mcp should be 405, got ${getMcp.status}`)
    const evil = await fetch(`http://127.0.0.1:${TEST_PORT}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })
    if (evil.status !== 403) throw new Error(`Foreign Origin should be refused, got ${evil.status}`)
    console.log('  ✓ Streamable HTTP: 202 for notifications, 405 for GET, 403 for foreign Origins.')

    // 5. Legacy SSE: the answer to a POST /messages arrives on the event stream
    const ctrl = new AbortController()
    const sse = await fetch(`http://127.0.0.1:${TEST_PORT}/sse`, { signal: ctrl.signal })
    const reader = sse.body.getReader()
    const decoder = new TextDecoder()
    let events = ''
    const readUntil = async (pattern) => {
      while (!pattern.test(events)) {
        const { value, done } = await reader.read()
        if (done) break
        events += decoder.decode(value)
      }
    }
    await readUntil(/sessionId=[\w-]+/)
    const endpoint = events.match(/data: (\/messages\?sessionId=[\w-]+)/)[1]
    const posted = await fetch(`http://127.0.0.1:${TEST_PORT}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 77, method: 'tools/list' }) })
    if (posted.status !== 202) throw new Error(`SSE POST should get 202, got ${posted.status}`)
    await readUntil(/event: message\ndata: .*"id":77/)
    ctrl.abort()
    console.log('  ✓ Legacy SSE: endpoint event, 202 on POST, response delivered on the stream.')
  } finally {
    httpProc.kill()
    console.log('  ✓ HTTP transport teardown clean.')
  }

  // --------------------------------------------------------------------------
  // PART 3: PROTOCOL DETAILS, LAB SEARCH, RESOURCES AND PROMPTS (offline)
  // --------------------------------------------------------------------------
  console.log('\n  [PART 3] Protocol details, labs, resources and prompts...')
  const proc = spawn('node', [MCP_ENTRY], { stdio: ['pipe', 'pipe', 'pipe'] })
  let out = ''
  proc.stdout.on('data', (c) => { out += c.toString() })
  const rpc = async (payload, wait = 300) => {
    proc.stdin.write(JSON.stringify(payload) + '\n')
    await delay(wait)
    return out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch (_) { return null } })
  }
  const byId = (msgs, id) => msgs.flat().find((m) => m && m.id === id)
  try {
    let msgs = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })
    const init = byId(msgs, 1)?.result
    if (init?.protocolVersion !== '2025-06-18' || !init.capabilities.resources || !init.capabilities.prompts || !init.instructions) throw new Error(`Bad initialize: ${JSON.stringify(init)}`)
    console.log('  ✓ Negotiates 2025-06-18 and advertises tools, resources, prompts and instructions.')

    const before = out.split('\n').filter(Boolean).length
    await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
    if (out.split('\n').filter(Boolean).length !== before) throw new Error('A notification got a reply')
    msgs = await rpc([{ jsonrpc: '2.0', id: 2, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/cancelled' }, { jsonrpc: '2.0', id: 3, method: 'ping' }])
    const batch = msgs.find((m) => Array.isArray(m))
    if (!batch || batch.length !== 2) throw new Error(`Batch should get 2 replies: ${JSON.stringify(batch)}`)
    console.log('  ✓ Notifications get no reply; batches are answered per request.')

    msgs = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search_labs', arguments: { query: 'nft royalties' } } })
    const search = byId(msgs, 4)?.result?.content?.[0]?.text || ''
    if (!search.includes('m03-06-base-layer-royalties')) throw new Error(`Multi-word search missed the royalties lab: ${search.slice(0, 300)}`)
    msgs = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_lab', arguments: { slug: 'm04-02-token-transfers' } } })
    const lab = byId(msgs, 5)?.result?.content?.[0]?.text || ''
    if (!lab.includes('Before you run') || !lab.includes('M3 Lab 01') || !lab.includes('```javascript')) throw new Error('get_lab lacks prerequisites or code')
    console.log('  ✓ search_labs ranks multi-word queries; get_lab returns prerequisites, cost and code.')

    msgs = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'anti_hallucination_rules', arguments: {} } })
    const rules = byId(msgs, 6)?.result?.content?.[0]?.text || ''
    if (!rules.includes('negated()') || !rules.includes('100,000,000')) throw new Error('Guardrails changed: expected the verified Hbar API and tinybar rules')
    msgs = await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'mirror_node_query', arguments: { endpoint: 'accounts', id: '../../etc/passwd' } } })
    if (!byId(msgs, 7)?.result?.isError) throw new Error('mirror_node_query accepted an invalid id')
    console.log('  ✓ Guardrails state the real Hbar API; mirror_node_query rejects invalid IDs.')

    msgs = await rpc({ jsonrpc: '2.0', id: 8, method: 'resources/list' })
    const resources = byId(msgs, 8)?.result?.resources || []
    if (resources.length < 270) throw new Error(`Expected every lab as a resource, got ${resources.length}`)
    msgs = await rpc({ jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: 'hbe://lab/es/m00-01-generate-wallet' } })
    if (!byId(msgs, 9)?.result?.contents?.[0]?.text?.includes('Lab 01')) throw new Error('resources/read failed')
    msgs = await rpc({ jsonrpc: '2.0', id: 10, method: 'prompts/get', params: { name: 'build_on_hedera', arguments: { goal: 'NFT loyalty badges' } } })
    if (!byId(msgs, 10)?.result?.messages?.length) throw new Error('prompts/get failed')
    console.log(`  ✓ ${resources.length} resources (every lab in both languages + guides) and prompts work.`)
  } finally {
    proc.kill()
  }

  console.log('✅ TEST 05 PASSED: Universal MCP Server verified over stdio, HTTP & tools schemas!')
  return true
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMcpServerTest().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
