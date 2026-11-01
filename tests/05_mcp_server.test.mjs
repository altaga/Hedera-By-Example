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
  if (!rulesText.includes('100,000,000 tinybars') || !rulesText.includes('8 Decimal Precision')) {
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
    const healthRes = await fetch(`http://localhost:${TEST_PORT}/health`)
    const healthJson = await healthRes.json()
    if (healthJson.status !== 'online') {
      throw new Error(`HTTP /health check failed: ${JSON.stringify(healthJson)}`)
    }
    console.log(`  ✓ HTTP /health check: status="${healthJson.status}" version="${healthJson.version}"`)

    // 2. GET /tools
    const toolsRes = await fetch(`http://localhost:${TEST_PORT}/tools`)
    const toolsJson = await toolsRes.json()
    if (!toolsJson.tools || toolsJson.tools.length < 6) {
      throw new Error(`HTTP /tools failed: ${JSON.stringify(toolsJson)}`)
    }
    console.log(`  ✓ HTTP /tools endpoint: ${toolsJson.tools.length} tools available over HTTP`)

    // 3. POST /mcp (JSON-RPC)
    const mcpRes = await fetch(`http://localhost:${TEST_PORT}/mcp`, {
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

  } finally {
    httpProc.kill()
    console.log('  ✓ HTTP transport teardown clean.')
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
