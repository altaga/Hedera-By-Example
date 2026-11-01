#!/usr/bin/env node
/**
 * ============================================================================
 * Hedera by Example (HBE) — Universal Model Context Protocol (MCP) Server
 * ============================================================================
 * Protocol Specification: Model Context Protocol (MCP) 2024-11-05
 * Supported Transports:
 *   1. Stdio (Standard Input/Output JSON-RPC 2.0) — Cursor, Claude Desktop, Antigravity, VS Code
 *   2. HTTP / SSE (Server-Sent Events) — Remote AI Agents, Web Workstations, Cloud IDEs
 * 
 * Features:
 *   - Query 131 runnable Hedera by Example labs (EN & ES)
 *   - Query Hedera Master Knowledge Graph & Architecture Decision Trees
 *   - Anti-hallucination rules (8 decimals, BigInt tinybars, HIP-904, fixed USD fees)
 *   - Live Hedera Mirror Node interrogation (accounts, tokens, topics)
 *   - Zero external npm dependencies (pure Node.js ESM)
 * ============================================================================
 */

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

// Resolve data paths
const catalogPath = path.join(__dirname, 'data', 'hedera_master_catalog.json')
const architecturePath = path.join(ROOT, 'docs', 'HEDERA_ARCHITECTURE_AND_GUARDRAILS.md')
const guidelinesPath = path.join(ROOT, 'docs', 'HACKATHON_RULES_AND_GUIDELINES.md')
const resourcesPath = path.join(ROOT, 'docs', 'OFFICIAL_HEDERA_RESOURCES.md')
const contentEnPath = path.join(ROOT, 'app', 'src', 'content', 'en.json')
const contentEsPath = path.join(ROOT, 'app', 'src', 'content', 'es.json')
const contentIndexPath = path.join(ROOT, 'app', 'src', 'content', 'index.json')

// Lazy load content caches
let masterCatalog = null
let architectureDoc = null
let guidelinesDoc = null
let resourcesDoc = null
let labsEn = null
let labsEs = null
let labsIndex = null

function loadData() {
  if (!masterCatalog && fs.existsSync(catalogPath)) {
    try { masterCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) } catch (_) {}
  }
  if (!architectureDoc && fs.existsSync(architecturePath)) {
    try { architectureDoc = fs.readFileSync(architecturePath, 'utf8') } catch (_) {}
  }
  if (!guidelinesDoc && fs.existsSync(guidelinesPath)) {
    try { guidelinesDoc = fs.readFileSync(guidelinesPath, 'utf8') } catch (_) {}
  }
  if (!resourcesDoc && fs.existsSync(resourcesPath)) {
    try { resourcesDoc = fs.readFileSync(resourcesPath, 'utf8') } catch (_) {}
  }
  if (!labsEn && fs.existsSync(contentEnPath)) {
    try { labsEn = JSON.parse(fs.readFileSync(contentEnPath, 'utf8')) } catch (_) {}
  }
  if (!labsEs && fs.existsSync(contentEsPath)) {
    try { labsEs = JSON.parse(fs.readFileSync(contentEsPath, 'utf8')) } catch (_) {}
  }
  if (!labsIndex && fs.existsSync(contentIndexPath)) {
    try { labsIndex = JSON.parse(fs.readFileSync(contentIndexPath, 'utf8')) } catch (_) {}
  }
}

loadData()

// ============================================================================
// TOOL DEFINITIONS (MCP SCHEMA)
// ============================================================================

const TOOLS = [
  {
    name: 'query_curriculum',
    description: 'Search and inspect any of the 131 runnable Hedera by Example labs. Returns full runnable code, concept, learnable moments, and SDK references.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term, concept, or SDK class (e.g., "x402", "TransferTransaction", "Merkle", "EVM", "TokenCreate")'
        },
        module: {
          type: 'string',
          description: 'Optional module prefix (e.g., "M0", "M3", "M10", "M15")'
        },
        lang: {
          type: 'string',
          enum: ['en', 'es'],
          description: 'Language of explanation and code comments (default: "en")'
        }
      }
    }
  },
  {
    name: 'query_knowledge',
    description: 'Query the Hedera Master Knowledge Graph across AI agents, RWA, DePIN, Passkeys, zk-TLS, and L1 consensus services.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Technology, protocol, or standard (e.g., "AI Studio", "ATS", "x402", "Guardian", "Passkeys", "HIP-904")'
        },
        category: {
          type: 'string',
          description: 'Filter category (e.g., "AI & Autonomous Agents", "DePIN & Hardware IoT", "Asset Tokenization & RWA")'
        },
        audience: {
          type: 'string',
          enum: ['developer', 'architect', 'business', 'founder'],
          description: 'Target audience perspective'
        }
      }
    }
  },
  {
    name: 'anti_hallucination_rules',
    description: 'Retrieve strict anti-hallucination rules and technical guardrails for building on Hedera with @hiero-ledger/sdk.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'architecture_decision_tree',
    description: 'Retrieve the architectural decision matrix guiding when to use Hedera Consensus Service (HCS), Token Service (HTS), or Smart Contracts (HSCS).',
    inputSchema: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description: 'Optional focus area (e.g., "cost", "throughput", "compliance", "ai-agents")'
        }
      }
    }
  },
  {
    name: 'mirror_node_query',
    description: 'Interrogate the public Hedera Mirror Node REST API in real-time. Free read-only state lookup for accounts, tokens, and topics.',
    inputSchema: {
      type: 'object',
      required: ['endpoint', 'id'],
      properties: {
        endpoint: {
          type: 'string',
          enum: ['accounts', 'tokens', 'topics', 'transactions'],
          description: 'Mirror node resource type'
        },
        id: {
          type: 'string',
          description: 'Hedera entity ID (e.g. "0.0.12345" or EVM address "0x...")'
        },
        network: {
          type: 'string',
          enum: ['testnet', 'mainnet'],
          description: 'Hedera network (default: "testnet")'
        }
      }
    }
  },
  {
    name: 'official_resources',
    description: 'Search official Hedera documentation, repositories, and specifications with verified update timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term for official URLs and documentation'
        }
      }
    }
  }
]

// ============================================================================
// TOOL HANDLERS
// ============================================================================

function handleQueryCurriculum(params = {}) {
  loadData()
  const lang = params.lang === 'es' ? 'es' : 'en'
  const store = lang === 'es' ? labsEs : labsEn
  if (!store || !labsIndex) {
    return 'Curriculum content not loaded. Run build-content compiler first.'
  }

  const query = (params.query || '').toLowerCase().trim()
  const queryNorm = query.replace(/[_-]/g, ' ')
  const modFilter = (params.module || '').toLowerCase().trim()

  const matches = []

  for (const [slug, lab] of Object.entries(store)) {
    if (modFilter && !slug.toLowerCase().startsWith(modFilter)) continue

    const slugNorm = slug.replace(/[_-]/g, ' ')
    let score = 0
    if (query) {
      if (slug.includes(query) || slugNorm.includes(queryNorm)) score += 5
      if (lab.title && lab.title.toLowerCase().includes(query)) score += 4
      if (lab.kicker && lab.kicker.toLowerCase().includes(query)) score += 3
      if (lab.sdk && lab.sdk.some(s => s.toLowerCase().includes(query))) score += 5
      if (lab.concept && lab.concept.some(c => c.toLowerCase().includes(query))) score += 2
      if (lab.moment && lab.moment.toLowerCase().includes(query)) score += 2
      if (score === 0) continue
    } else {
      score = 1
    }

    matches.push({ slug, lab, score })
  }

  matches.sort((a, b) => b.score - a.score)
  const topMatches = matches.slice(0, 3)

  if (topMatches.length === 0) {
    return `No labs found matching query: "${query}" in language "${lang}". Try querying SDK classes like "PrivateKey", "TopicMessageSubmitTransaction", or "TransferTransaction".`
  }

  return topMatches.map(({ slug, lab }) => {
    const fullCode = lab.segments.map(s => s.code).join('\n')
    return `## Lab: ${lab.title} (${slug})
**Concept:** ${lab.kicker || 'Hedera Architecture'}
**SDK Classes:** ${(lab.sdk || []).join(', ') || 'Core SDK'}
**Architectural Guardrail:** ${lab.moment || 'None'}

### Runnable Code (${lang.toUpperCase()}):
\`\`\`javascript
${fullCode}
\`\`\`

**Official References:**
${(lab.refs || []).map(r => `- ${r}`).join('\n') || '- https://docs.hedera.com'}`
  }).join('\n\n---\n\n')
}

function handleQueryKnowledge(params = {}) {
  loadData()
  if (!masterCatalog || !masterCatalog.resources) {
    return 'Master knowledge catalog not found.'
  }

  const { query, category, audience } = params
  let results = masterCatalog.resources

  if (category) {
    results = results.filter(r => r.category.toLowerCase().includes(category.toLowerCase()))
  }
  if (audience) {
    results = results.filter(r => r.audience.includes(audience.toLowerCase()))
  }
  if (query) {
    const q = query.toLowerCase()
    results = results.filter(r => {
      const inName = r.name.toLowerCase().includes(q)
      const inSummary = r.summary.toLowerCase().includes(q)
      const inTriggers = r.searchTriggers.some(t => t.toLowerCase().includes(q))
      return inName || inSummary || inTriggers
    })
  }

  if (results.length === 0) {
    return `No matching Hedera resources found for "${query || category}". Available categories include: "AI & Autonomous Agents", "Asset Tokenization & RWA", "DePIN & Hardware IoT", "Smart Contracts & EVM".`
  }

  return results.slice(0, 5).map(r => `### ${r.name} [Weight: ${r.weight}]
- **Category:** ${r.category} (${r.layer})
- **Summary:** ${r.summary}
- **Business Value:** ${r.businessValue}
- **Tech Stack:** ${r.technicalStack}
- **URLs:** ${Object.entries(r.urls).map(([k, v]) => `[${k}](${v})`).join(' | ')}
- **Anti-Hallucination Warning:** ${r.antiHallucinationNotes}`).join('\n\n')
}

function handleAntiHallucinationRules() {
  return `### HEDERA CRITICAL ANTI-HALLUCINATION RULES FOR AI CODING AGENTS:
1. **8 Decimal Precision (Tinybars):**
   1 HBAR = 100,000,000 tinybars (10^8), NEVER 18 decimals like Ethereum wei.
   1 Hbar = new Hbar(1) -> 100_000_000 tinybars.

2. **Hbar Arithmetic:**
   Hbar objects in @hiero-ledger/sdk do NOT possess arithmetic methods (.plus, .minus, .negated).
   Convert to BigInt tinybars for math: \`BigInt(hbar.toTinybars().toString())\`.

3. **HTS NFT Metadata Limit:**
   HTS NFT on-chain metadata string is strictly capped at 100 bytes.
   Never store full JSON or large strings on-chain; store deterministic IPFS/Arweave URIs (\`ipfs://...\`).

4. **Token Association Requirement:**
   Hedera accounts cannot receive arbitrary HTS tokens unless explicitly associated or transferred via HIP-904 native airdrop transactions with auto-association slots.

5. **x402 Micropayment Architectures:**
   There are TWO distinct x402 implementations on Hedera:
   - Direct P2P (Buyer + Seller): Single-use challenge nonces in transaction memo (\`x402:direct:<nonce>\`).
   - Sponsored Facilitator (Buyer + Seller + Facilitator): Gasless client where facilitator settles on-chain.

6. **Deterministic USD-Pegged Fees:**
   Fees on Hedera are fixed in USD ($0.0001 for HCS, $0.001 for HTS transfers, $1.00 for token creation) and paid in HBAR using real-time automated network exchange rates. No gas spikes, no front-running, no miner tips.`
}

function handleArchitectureDecisionTree(params = {}) {
  loadData()
  if (architectureDoc) {
    return architectureDoc
  }
  return `### HEDERA TRI-SERVICE ARCHITECTURE MATRIX:
- **HCS (Hedera Consensus Service):** Sub-second verifiable ordering, audit logging, telemetry, AI reasoning audit streams, zk-TLS anchoring. Cost: $0.0001 / msg.
- **HTS (Hedera Token Service):** Native fungible & non-fungible tokens settled directly on hashgraph L1 without EVM bytecode. Cost: $0.001 / transfer.
- **HSCS (Hedera Smart Contract Service):** Full EVM compatibility (Solidity / Besu) with native precompiles (0x167) bridging directly to HTS.`
}

async function handleMirrorNodeQuery(params = {}) {
  const { endpoint, id, network = 'testnet' } = params
  const baseUrl = network === 'mainnet'
    ? 'https://mainnet-public.mirrornode.hedera.com'
    : 'https://testnet.mirrornode.hedera.com'

  const targetUrl = `${baseUrl}/api/v1/${endpoint}/${encodeURIComponent(id)}`
  try {
    const res = await fetch(targetUrl, { headers: { 'Accept': 'application/json' } })
    if (!res.ok) {
      return `Mirror node query failed [HTTP ${res.status}]: ${res.statusText} at ${targetUrl}`
    }
    const data = await res.json()
    return `### Live Mirror Node State (${network.toUpperCase()})
**Endpoint:** \`${targetUrl}\`
\`\`\`json
${JSON.stringify(data, null, 2)}
\`\`\``
  } catch (err) {
    return `Error connecting to Hedera Mirror Node: ${err.message}`
  }
}

function handleOfficialResources(params = {}) {
  loadData()
  if (resourcesDoc) {
    const q = (params.query || '').toLowerCase()
    if (!q) return resourcesDoc
    const lines = resourcesDoc.split('\n')
    const matches = lines.filter(l => l.toLowerCase().includes(q) || l.startsWith('| Resource') || l.startsWith('| :---'))
    return matches.join('\n')
  }
  return 'Official resources documentation file not found.'
}

// ============================================================================
// PROTOCOL DISPATCHER (JSON-RPC 2.0)
// ============================================================================

async function dispatchJsonRpc(request) {
  const { id, method, params } = request

  // 1. MCP Lifecycle: initialize
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: false }
        },
        serverInfo: {
          name: 'hedera-by-example-mcp',
          version: '1.0.0'
        }
      }
    }
  }

  // 2. MCP Lifecycle: notifications/initialized
  if (method === 'notifications/initialized') {
    return null
  }

  // 3. MCP Tools: list
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: TOOLS
      }
    }
  }

  // 4. MCP Tools: call
  if (method === 'tools/call') {
    const { name, arguments: args } = params || {}
    let text = ''

    try {
      switch (name) {
        case 'query_curriculum':
          text = handleQueryCurriculum(args)
          break
        case 'query_knowledge':
          text = handleQueryKnowledge(args)
          break
        case 'anti_hallucination_rules':
          text = handleAntiHallucinationRules()
          break
        case 'architecture_decision_tree':
          text = handleArchitectureDecisionTree(args)
          break
        case 'mirror_node_query':
          text = await handleMirrorNodeQuery(args)
          break
        case 'official_resources':
          text = handleOfficialResources(args)
          break
        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Unknown tool: ${name}` }
          }
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            { type: 'text', text }
          ]
        }
      }
    } catch (toolErr) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: `Tool error: ${toolErr.message}` }]
        }
      }
    }
  }

  // 5. Ping
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` }
  }
}

// ============================================================================
// TRANSPORTS: STDIO & HTTP/SSE
// ============================================================================

function startStdioTransport() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  })

  rl.on('line', async (line) => {
    const trimmed = line.trim()
    if (!trimmed) return

    try {
      const request = JSON.parse(trimmed)
      const response = await dispatchJsonRpc(request)
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n')
      }
    } catch (err) {
      const errorResp = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${err.message}` }
      }
      process.stdout.write(JSON.stringify(errorResp) + '\n')
    }
  })

  process.stderr.write('[MCP] Hedera by Example MCP Server listening on stdio (JSON-RPC 2.0)\n')
}

function startHttpTransport(port = 3001) {
  const server = http.createServer(async (req, res) => {
    // CORS headers for universal web studio access
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

    // 1. Health check
    if (url.pathname === '/health' || url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'online',
        server: 'hedera-by-example-mcp',
        version: '1.0.0',
        toolsCount: TOOLS.length,
        endpoints: ['/mcp', '/sse', '/tools', '/health']
      }, null, 2))
      return
    }

    // 2. Tools manifest
    if (url.pathname === '/tools' || url.pathname === '/mcp/tools.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ tools: TOOLS }, null, 2))
      return
    }

    // 3. SSE Transport (Server-Sent Events)
    if (url.pathname === '/sse') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })
      res.write(`event: endpoint\ndata: /mcp\n\n`)
      return
    }

    // 4. JSON-RPC POST Handler
    if (url.pathname === '/mcp' || url.pathname === '/api/mcp') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', async () => {
        try {
          const json = JSON.parse(body)
          const response = await dispatchJsonRpc(json)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(response || { jsonrpc: '2.0', id: json.id, result: {} }))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32700, message: `Invalid JSON payload: ${err.message}` }
          }))
        }
      })
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Endpoint not found' }))
  })

  server.listen(port, () => {
    console.log(`[MCP HTTP] Hedera by Example MCP Server running at: http://localhost:${port}`)
    console.log(`  - Tools manifest: http://localhost:${port}/tools`)
    console.log(`  - JSON-RPC POST:  http://localhost:${port}/mcp`)
    console.log(`  - SSE Endpoint:   http://localhost:${port}/sse`)
  })
}

// CLI Argument parsing
const args = process.argv.slice(2)
const isHttp = args.includes('--http') || args.includes('-p') || args.includes('--port')

if (isHttp) {
  const portIdx = args.findIndex(a => a === '--http' || a === '-p' || a === '--port')
  const port = (portIdx !== -1 && args[portIdx + 1] && !isNaN(Number(args[portIdx + 1])))
    ? Number(args[portIdx + 1])
    : 3001
  startHttpTransport(port)
} else {
  startStdioTransport()
}
