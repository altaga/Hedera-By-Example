/**
 * ============================================================================
 * Hedera by Example (HBE) — In-Memory MCP Server Core Engine
 * ============================================================================
 * Powering both Streamable HTTP and Edge Serverless execution at /api/mcp.
 * Implements JSON-RPC 2.0 over MCP protocol specifications 2024-11-05 & 2025-03-26.
 * Zero filesystem dependencies at runtime (100% in-memory data structures).
 * ============================================================================
 */

import indexData from '../content/index.json'
import enData from '../content/en.json'
import esData from '../content/es.json'
import catalogData from './data/hedera_master_catalog.json'
import { recordMcpSessionStarted, recordMcpToolCall, runAnalyticsSilently } from './posthogAnalytics'
import { createSessionId, identifyCaller } from './mcpIdentity'
import { ARCHITECTURE_DOC, HACKATHON_DOC, RESOURCES_DOC } from './mcpDocsData'

export const VERSION = '2.0.0'
export const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
export const WEB = 'https://hbe.expo.app'
export const REPO = 'https://github.com/altaga/Hedera-By-Example'

const MIRROR: Record<string, string> = {
  testnet: 'https://testnet.mirrornode.hedera.com',
  mainnet: 'https://mainnet-public.mirrornode.hedera.com',
  previewnet: 'https://previewnet.mirrornode.hedera.com'
}

const LANG_DIR: Record<string, string> = { en: 'English', es: 'Spanish' }
const langOf = (v: any) => (v === 'es' ? 'es' : 'en')

function labCatalog () {
  const idx = indexData as any
  if (!idx?.modules) return []
  return idx.modules.flatMap((m: any) => m.labs.map((l: any) => ({ module: m, lab: l })))
}

function labBody (slug: string, lang: 'en' | 'es') {
  const store: Record<string, any> = lang === 'es' ? esData : enData
  return store[slug] || (enData as Record<string, any>)[slug] || null
}

const labCode = (body: any) => (body.segments || []).map((s: any) => s.code).filter(Boolean).join('\n\n')
const moduleId = (m: any) => `M${m.n}`

const LABELS_EN = { lab: 'Lab', concept: 'Concept', moment: 'Learnable moment', sdk: 'SDK classes', simulated: 'Simulated in this lab', browser: 'Run it in the browser', source: 'Source', local: 'Run locally', env: 'needs a `.env` with OPERATOR_ID and OPERATOR_PRIVATE_KEY', refs: 'Official references', code: 'Code' }
const LABELS_ES: typeof LABELS_EN = { lab: 'Lab', concept: 'Concepto', moment: 'Momento clave', sdk: 'Clases del SDK', simulated: 'Simulado en este lab', browser: 'Ejecútalo en el navegador', source: 'Código fuente', local: 'Ejecutar localmente', env: 'requiere un `.env` con OPERATOR_ID y OPERATOR_PRIVATE_KEY', refs: 'Referencias oficiales', code: 'Código' }

function labMarkdown (slug: string, lang: 'en' | 'es', { includeCode = true }: { includeCode?: boolean } = {}) {
  const entry = labCatalog().find((e: any) => e.lab.slug === slug)
  const body = labBody(slug, lang)
  if (!entry || !body) return null
  const { module: m, lab } = entry
  const meta = lab[lang] || lab.en
  const L = lang === 'es' ? LABELS_ES : LABELS_EN
  const out = [
    `# ${moduleId(m)} ${L.lab} ${lab.n}: ${body.title || meta.title}`,
    `*${m[lang]?.title || m.en.title}* · \`${slug}\``,
    '',
    body.kicker ? `**${L.concept}:** ${body.kicker}` : '',
    ...(body.concept || []).map((p: string) => p),
    body.moment ? `**${L.moment}:** ${body.moment}` : ''
  ]
  if (body.before?.length) {
    out.push('', lang === 'es' ? '## Antes de ejecutar' : '## Before you run')
    for (const b of body.before) out.push(`- ${b.label ? `**${b.label}:** ` : ''}${b.text}`)
  }
  if (body.sdk?.length) out.push('', `**${L.sdk}:** ${body.sdk.map((s: string) => `\`${s}\``).join(', ')}`)
  if (body.simulated) out.push('', `**${L.simulated}:** ${body.simulated}`)
  out.push('', `**${L.browser}:** ${WEB}/#${slug}`,
    `**${L.source}:** ${REPO}/blob/master/course/${LANG_DIR[lang]}/${m.dir}/${lab.file}`,
    `**${L.local}:** \`cd course && npm ci && node ${LANG_DIR[lang]}/${m.dir}/${lab.file}\` (${L.env})`)
  if (body.refs?.length) out.push('', `**${L.refs}:**`, ...body.refs.map((r: string) => `- ${r}`))
  if (includeCode) out.push('', `## ${L.code}`, '```javascript', labCode(body), '```')
  return out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'how', 'do', 'i', 'is', 'el', 'la', 'los', 'las', 'de', 'del', 'en', 'un', 'una', 'y', 'o', 'con', 'como', 'para', 'por', 'que'])
const tokens = (q: any) => String(q || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9.]+/).filter((t) => t.length > 1 && !STOP.has(t))
const norm = (s: any) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function searchLabs ({ query = '', lang = 'en', module, limit = 5 }: { query?: string; lang?: 'en' | 'es'; module?: string; limit?: number } = {}) {
  const words = tokens(query)
  const modFilter = module ? String(module).toUpperCase().replace(/^M?/, 'M') : null
  const scored: any[] = []
  for (const { module: m, lab } of labCatalog()) {
    if (modFilter && moduleId(m) !== modFilter) continue
    const body = labBody(lab.slug, lang as any)
    if (!body) continue
    const fields = {
      title: norm(`${body.title} ${lab.en?.title || ''} ${lab.slug}`),
      kicker: norm(body.kicker),
      sdk: (body.sdk || []).map(norm),
      text: norm([...(body.concept || []), body.moment].join(' ')),
      docs: norm((body.segments || []).flatMap((s: any) => s.doc || []).join(' ')),
      code: norm(labCode(body))
    }
    let score = words.length ? 0 : 1
    let hits = 0
    for (const w of words) {
      let s = 0
      if (fields.sdk.some((c: string) => c === w)) s += 8
      else if (fields.sdk.some((c: string) => c.includes(w))) s += 4
      if (fields.title.includes(w)) s += 5
      if (fields.kicker.includes(w)) s += 3
      if (fields.text.includes(w)) s += 2
      if (fields.docs.includes(w)) s += 1.5
      if (fields.code.includes(w)) s += 1
      if (s) hits++
      score += s
    }
    if (words.length && hits === 0) continue
    if (words.length > 1) score *= 0.5 + hits / words.length
    scored.push({ score, module: m, lab, body })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(1, Math.min(Number(limit) || 5, 20)))
}

const summaryLine = ({ module: m, lab, body }: any, lang: string) => {
  const cost = (body.before || []).find((b: any) => /cost|costo/i.test(b.label))
  const first = (body.before || []).find((b: any) => /run first|ejecuta antes/i.test(b.label))
  return [`- **${moduleId(m)} Lab ${lab.n} — ${body.title}** (\`${lab.slug}\`)`,
    body.kicker ? `  ${body.kicker}` : '',
    body.sdk?.length ? `  SDK: ${body.sdk.slice(0, 8).join(', ')}` : '',
    first ? `  ${first.label}: ${first.text}` : '',
    cost ? `  ${cost.label}: ${cost.text}` : '',
    `  ${WEB}/#${lab.slug}`].filter(Boolean).join('\n')
}

export const GUARDRAILS = `# Hedera guardrails for coding agents (@hiero-ledger/sdk)
Each rule was checked against the SDK and testnet while building this course.

## Units and money
1. **8 decimals.** 1 HBAR = 100,000,000 tinybars (10^8), not 10^18. \`new Hbar(1)\` = 100_000_000 tinybars; \`Hbar.fromTinybars(n)\` goes the other way.
2. **Hbar arithmetic.** \`Hbar\` has \`toTinybars()\`, \`to(unit)\`, \`negated()\`, \`isNegative()\` and \`toBigNumber()\`, but **no** \`plus()\` / \`minus()\`: add and subtract in tinybars (Long/BigInt), then build a new \`Hbar\`.
3. **JSON-RPC uses weibars.** Through the relay (Hashio, chain IDs 295 mainnet / 296 testnet) values are 18-decimal "weibars": 1 tinybar = 10^10 weibar. Ask the relay for \`eth_gasPrice\`; EIP-1559 estimates from fee history can come out below its minimum.

## Fees and gas
4. **Fees are fixed in USD and paid in HBAR** at the network exchange rate: about $0.0001 per HBAR transfer or HCS message, $0.001 per token transfer, $0.05 per account creation or token association, $1 per token creation ($2 with custom fees), $2 per HIP-991 topic with custom fees, $1 + gas per contract deployment. Use the \`estimate_cost\` tool for today's HBAR amounts.
5. **Set a realistic gas limit.** Since HIP-1249 only the gas actually used is charged (the old 80%-of-limit minimum is gone), but the limit reserves throttle capacity and one too low fails with INSUFFICIENT_GAS and still pays for the gas used. Estimate first with the Mirror Node (\`POST /api/v1/contracts/call\` with \`estimate: true\`, free) and add ~25%. Max gas per transaction: 15,000,000 (INDIVIDUAL_TX_GAS_LIMIT_EXCEEDED above it). Simulations of system contracts (HTS 0x167, HSS 0x16b) can be far above the real use.

## Accounts and keys
6. **Raw 32-byte private keys are ambiguous**: the same hex fits ECDSA (secp256k1) and Ed25519. Prefer DER (\`302e…\` Ed25519, \`3030…\` ECDSA), or \`PrivateKey.fromStringECDSA()\` / \`fromStringED25519()\` explicitly. Guessing the curve gives INVALID_SIGNATURE.
7. **Two EVM addresses.** Every account has a long-zero address (0x000…<account number>); ECDSA accounts created from an EVM address also have an alias (keccak of the public key). Send to and verify against the one the account actually uses (Mirror Node \`/accounts/{id}\` → \`evm_address\`).
8. **Lazy creation.** Sending HBAR to an unused ECDSA EVM address creates the account (HIP-583); the receiver's key signs nothing until it spends.
9. **Associations.** An account can hold a token only after associating it, or through free auto-association slots. HIP-904 airdrops arrive at once when a slot is free and stay pending (claim/cancel/reject) otherwise. Associating twice fails with TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT.

## Data limits
10. **NFT metadata: 100 bytes.** Store a URI/CID (ipfs://…), not the JSON (METADATA_TOO_LONG otherwise).
11. **Memos: 100 bytes** for transaction, account, token and topic memos.
12. **HCS messages: 1,024 bytes per chunk.** \`TopicMessageSubmitTransaction\` chunks larger messages (SDK \`CHUNK_SIZE\` 1024, \`maxChunks\` 20 by default, so ~20 KB unless raised; each chunk is its own paid transaction). A whole transaction, signatures included, is capped at 6,144 bytes (https://docs.hedera.com/hedera/sdks-and-apis/sdks/transactions).
13. **HFS files: ~4 KB per transaction.** Create with the first chunk, then \`FileAppendTransaction\`; storage is billed by size and lifetime.

## Reading state
14. **Read from the Mirror Node, not consensus nodes.** \`AccountBalanceQuery\` is deprecated in @hiero-ledger/sdk (its consensus-node endpoint \`cryptoGetBalance\` was removed) and \`AccountInfoQuery\` is a paid query; use \`MirrorNodeAccountBalanceQuery\` or the REST API (\`/api/v1/...\`). Reads are free but **a few seconds behind consensus**: poll until a new entity appears.
15. **Receipts vs records.** \`getReceipt()\` gives status and new IDs (free); \`getRecord()\` adds transfers, fees and contract results (paid query).
16. **Public Mirror Nodes are rate-limited** per IP: back off on HTTP 429 and avoid bursts.

## Scheduling and keys
17. **Scheduled transactions** wait until every required key signs or they expire (HIP-423 allows a custom expiry and \`waitForExpiry\`). A KeyList with a threshold needs M of N signatures.

Sources: https://docs.hedera.com · https://hedera.com/fees · https://hips.hedera.com · ${WEB}`

const ID_RE = /^(\d+\.\d+\.\d+(-[a-z]{5})?|0x[0-9a-fA-F]{40}|\d+\.\d+\.\d+-\d+-\d+|\d+\.\d+\.\d+@\d+\.\d+)$/
const MIRROR_ROUTES: Record<string, string[] | null> = {
  accounts: ['', 'tokens', 'nfts', 'allowances/crypto', 'allowances/tokens', 'rewards'],
  tokens: ['', 'nfts', 'balances'],
  topics: ['', 'messages'],
  transactions: [''],
  contracts: ['', 'results', 'state'],
  schedules: [''],
  balances: null,
  'network/exchangerate': null,
  'network/fees': null,
  'network/supply': null,
  'network/nodes': null,
  blocks: null
}

const decode64 = (s: string) => { try { return Buffer.from(s, 'base64').toString('utf8') } catch (_) { return s } }

export class UpstreamError extends Error {}

const MIRROR_NETWORKS = ['testnet', 'mainnet', 'previewnet']
const MIRROR_TIMEOUT_MS = 10000

// Strict: never fall back to another network. Only the exact lowercase names are accepted.
function requireNetwork (network: any, allowed: string[]) {
  const n = network === undefined || network === null ? 'testnet' : network
  if (typeof n !== 'string' || !allowed.includes(n)) throw new InvalidParams(`network must be one of: ${allowed.join(', ')} (lowercase; got ${JSON.stringify(network)})`)
  return n
}

async function mirrorGet (network: string, apiPath: string) {
  const base = MIRROR[network]
  if (!base) throw new InvalidParams(`network must be one of: ${MIRROR_NETWORKS.join(', ')}`)
  const url = `${base}/api/v1/${apiPath}`
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS) })
  } catch (err: any) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return { url, ok: false, status: 0, data: null, text: timedOut ? `timed out after ${MIRROR_TIMEOUT_MS / 1000}s` : `request failed (${err?.message || 'network error'})` }
  }
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch (_) {}
  return { url, ok: res.ok, status: res.status, data, text }
}

const describeFailure = (r: { url: string, status: number, text: string }) => `Mirror Node ${r.status ? `answered HTTP ${r.status}` : 'request failed'} for ${r.url}\n${r.text.slice(0, 500)}`

// Pagination: only a relative Mirror Node `links.next` for the same resource is accepted.
const NEXT_QS_RE = /^[A-Za-z0-9_.:=&%-]*$/
function validateNext (next: any, basePath: string) {
  if (typeof next !== 'string' || next.length > 600) throw new InvalidParams('next must be the relative links.next string returned by a previous call')
  const prefix = `/api/v1/${basePath}?`
  if (!next.startsWith(prefix)) throw new InvalidParams(`next must start with ${prefix} (same endpoint, id and sub as this call)`)
  const qs = next.slice(prefix.length)
  if (!qs || !NEXT_QS_RE.test(qs) || qs.includes('..')) throw new InvalidParams('next contains characters that are not allowed')
  return next.slice('/api/v1/'.length)
}

async function handleMirrorNodeQuery ({ endpoint, id, sub = '', network, limit, order, next }: any = {}) {
  const net = requireNetwork(network, MIRROR_NETWORKS)
  if (!(endpoint in MIRROR_ROUTES)) throw new InvalidParams(`endpoint must be one of: ${Object.keys(MIRROR_ROUTES).join(', ')}`)
  const subs = MIRROR_ROUTES[endpoint]
  let apiPath = endpoint
  if (subs) {
    if (!id || !ID_RE.test(String(id).trim())) throw new InvalidParams('id must be a Hedera ID (0.0.123), an EVM address (0x…) or a transaction ID')
    if (!subs.includes(sub)) throw new InvalidParams(`sub for ${endpoint} must be one of: ${subs.map((s) => s || '(none)').join(', ')}`)
    apiPath += `/${encodeURIComponent(String(id).trim())}${sub ? `/${sub}` : ''}`
  }
  if (next !== undefined && next !== null && next !== '') {
    apiPath = validateNext(next, apiPath)
  } else {
    const qs = new URLSearchParams()
    if (limit !== undefined && limit !== null) {
      if (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100) throw new InvalidParams(`limit must be an integer from 1 to 100 (got ${JSON.stringify(limit)})`)
      qs.set('limit', String(Number(limit)))
    }
    if (order === 'asc' || order === 'desc') qs.set('order', order)
    if (endpoint === 'accounts' && !sub) qs.set('transactions', 'false')
    if ([...qs].length) apiPath += `?${qs}`
  }
  const r = await mirrorGet(net, apiPath)
  if (!r.ok) throw new UpstreamError(describeFailure(r))
  const data = r.data
  if (endpoint === 'topics' && sub === 'messages' && Array.isArray(data?.messages)) {
    for (const m of data.messages) m.message_decoded = decode64(m.message)
  }
  let json = JSON.stringify(data, null, 2)
  if (json.length > 20000) json = json.slice(0, 20000) + '\n… (truncated; use limit to read less)'
  const nextLink = typeof data?.links?.next === 'string' ? data.links.next : null
  return `### Mirror Node (${net}) — ${r.url}\n\`\`\`json\n${json}\n\`\`\`` +
    (nextLink ? `\n\nMore results: call again with the same endpoint/id/sub/network and next = "${nextLink}"` : '')
}

const FEES_USD: Record<string, [number, string]> = {
  hbar_transfer: [0.0001, 'HBAR transfer (CryptoTransfer)'],
  token_transfer: [0.001, 'HTS token transfer'],
  account_create: [0.05, 'Account creation'],
  account_update: [0.00022, 'Account update'],
  allowance_approve: [0.05, 'Allowance approval'],
  token_create: [1.0, 'Token creation'],
  token_create_custom_fees: [2.0, 'Token creation with custom fees'],
  token_associate: [0.05, 'Token association'],
  token_mint_ft: [0.001, 'Fungible token mint'],
  nft_mint: [0.02, 'NFT mint (per serial)'],
  token_airdrop: [0.1, 'HIP-904 airdrop'],
  topic_create: [0.01, 'Topic creation'],
  topic_create_custom_fees: [2.0, 'HIP-991 topic with custom fees'],
  topic_message: [0.0001, 'HCS message (small)'],
  schedule_create: [0.01, 'Scheduled transaction'],
  schedule_sign: [0.001, 'Schedule signature'],
  file_create: [0.05, 'File creation (plus size/lifetime)'],
  file_append: [0.05, 'File append (plus size/lifetime)'],
  contract_create: [1.0, 'Contract deployment (plus gas)'],
  contract_call: [0.0, 'Contract call (gas only)']
}

async function handleEstimateCost ({ operations = [], network }: any = {}) {
  const net = requireNetwork(network, ['testnet', 'mainnet'])
  if (!Array.isArray(operations) || operations.length === 0) throw new InvalidParams(`operations must list items like { "type": "token_create", "count": 1 }. Types: ${Object.keys(FEES_USD).join(', ')}`)
  const ops = operations.map((op: any) => {
    const fee = FEES_USD[op?.type]
    if (!fee) throw new InvalidParams(`unknown operation type "${op?.type}". Types: ${Object.keys(FEES_USD).join(', ')}`)
    const count = op.count === undefined || op.count === null ? 1 : Number(op.count)
    if (!Number.isInteger(count) || count < 1) throw new InvalidParams(`count for "${op.type}" must be a positive integer (got ${JSON.stringify(op.count)})`)
    const isContract = op.type === 'contract_create' || op.type === 'contract_call'
    let gas: number | null = null
    if (op.gas !== undefined && op.gas !== null) {
      if (!isContract) throw new InvalidParams(`gas only applies to contract_create / contract_call (got it on "${op.type}")`)
      gas = Number(op.gas)
      if (!Number.isInteger(gas) || gas < 1 || gas > 15000000) throw new InvalidParams(`gas for "${op.type}" must be an integer from 1 to 15,000,000 (got ${JSON.stringify(op.gas)})`)
    }
    return { type: op.type, fee, count, isContract, gas }
  })
  const needsGas = ops.some((o: any) => o.isContract && o.gas)
  const [rate, fees] = await Promise.all([mirrorGet(net, 'network/exchangerate'), needsGas ? mirrorGet(net, 'network/fees') : Promise.resolve(null)])
  const cr = rate.ok ? rate.data?.current_rate : null
  const usdPerHbar = cr && cr.hbar_equivalent ? cr.cent_equivalent / cr.hbar_equivalent / 100 : null
  const gasTinybars: Record<string, number> = {}
  for (const f of (fees && fees.ok ? fees.data?.fees : null) || []) gasTinybars[f.transaction_type] = Number(f.gas)
  const rows = []
  const notes: string[] = []
  let feeUsd = 0
  let gasHbarTotal = 0
  let incomplete = false
  for (const o of ops) {
    const usd = o.fee[0] * o.count
    feeUsd += usd
    let gasCell = ''
    if (o.isContract) {
      if (!o.gas) {
        incomplete = true
        gasCell = ' + gas not included'
        notes.push(`${o.type}: no gas limit given, so its gas is NOT in the total. Pass "gas" (estimate with the Mirror Node /api/v1/contracts/call, estimate: true).`)
      } else {
        const price = gasTinybars[o.type === 'contract_create' ? 'ContractCreate' : 'ContractCall'] || gasTinybars.ContractCall
        if (!price) {
          incomplete = true
          gasCell = ' + gas price unavailable'
          notes.push(`${o.type}: live gas price unavailable (Mirror Node /network/fees ${fees ? describeFailure(fees).split('\n')[0] : 'not read'}), so gas is NOT in the total.`)
        } else {
          const g = (o.gas * price * o.count) / 1e8
          gasHbarTotal += g
          gasCell = ` + ${g.toFixed(4)} ℏ gas${usdPerHbar ? ` ($${(g * usdPerHbar).toFixed(4)})` : ''}`
        }
      }
    }
    rows.push(`| ${o.fee[1]} | ${o.count} | $${usd.toFixed(4)} | ${usdPerHbar ? (usd / usdPerHbar).toFixed(4) : '?'} ℏ${gasCell} |`)
  }
  if (!usdPerHbar) notes.push(`Live exchange rate unavailable (${describeFailure(rate).split('\n')[0]}): HBAR amounts and gas in USD cannot be computed.`)
  const gasUsd = usdPerHbar ? gasHbarTotal * usdPerHbar : null
  const totalUsd = gasUsd != null ? feeUsd + gasUsd : (gasHbarTotal ? null : feeUsd)
  const totalHbar = usdPerHbar ? feeUsd / usdPerHbar + gasHbarTotal : null
  const label = incomplete ? '**Total (incomplete: excludes gas, see notes)**' : '**Total**'
  return [`### Estimated cost on ${net}`,
    usdPerHbar ? `Exchange rate now: 1 ℏ = $${usdPerHbar.toFixed(5)} (Mirror Node ${net} /network/exchangerate)` : 'Exchange rate unavailable: showing USD fees only.',
    '', '| Operation | Count | USD | HBAR |', '| :--- | ---: | ---: | ---: |', ...rows,
    `| ${label} | | **${totalUsd != null ? '$' + totalUsd.toFixed(4) : '?'}** | **${totalHbar != null ? totalHbar.toFixed(4) : '?'} ℏ** |`,
    ...(notes.length ? ['', ...notes.map((n) => `- ${n}`)] : []),
    '', 'Assumptions: USD fees are approximate values of the network fee schedule (https://hedera.com/fees), not read live; HBAR uses the live Mirror Node exchange rate; gas uses the live Mirror Node gas price (tinybars per gas) times the gas limit you give, i.e. an upper bound (since HIP-1249 only gas actually used is charged). HCS messages and files also grow with size.'].join('\n')
}

export class InvalidParams extends Error {}

const LANG_PROP = { type: 'string', enum: ['en', 'es'], description: 'Course language (default "en")' }
export const TOOLS = [
  {
    name: 'search_labs',
    title: 'Search the labs',
    description: 'Find the Hedera by Example labs that teach something (free text in English or Spanish, SDK class names, HIP/HCS numbers). Returns a ranked list with what each lab needs, its cost and a link; use get_lab for the code.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'e.g. "nft royalties", "TopicMessageSubmitTransaction", "HIP-904 airdrop", "x402"' }, module: { type: 'string', description: 'Optional module, e.g. "M3"' }, lang: LANG_PROP, limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Results (default 5)' } }, required: ['query'] },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'get_lab',
    title: 'Get a lab',
    description: 'Full lab: concept, what to run first, wallets it needs, approximate HBAR cost, official references and the complete runnable code.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string', description: 'Lab slug from search_labs or list_labs, e.g. "m03-01-immutable-issuance"' }, lang: LANG_PROP, include_code: { type: 'boolean', description: 'Include the code (default true)' } }, required: ['slug'] },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'list_labs',
    title: 'List the course',
    description: 'The course map: 16 modules and 131 labs with their slugs, optionally for one module.',
    inputSchema: { type: 'object', properties: { module: { type: 'string', description: 'Optional module, e.g. "M8"' }, lang: LANG_PROP } },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'query_curriculum',
    title: 'Search labs with code',
    description: 'Search the labs and return the best matches with their full code (heavier than search_labs + get_lab).',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search term, concept or SDK class' }, module: { type: 'string', description: 'Optional module, e.g. "M3"' }, lang: LANG_PROP, limit: { type: 'integer', minimum: 1, maximum: 5, description: 'Labs with code (default 3)' } } },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'anti_hallucination_rules',
    title: 'Hedera guardrails',
    description: 'Verified rules that prevent the usual mistakes on Hedera: tinybar units, Hbar math, fees and gas, key types, EVM addresses, associations, size limits, Mirror Node lag.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'architecture_decision_tree',
    title: 'HCS vs HTS vs smart contracts',
    description: 'When to use the Consensus Service, the Token Service or smart contracts, with the full guardrails guide.',
    inputSchema: { type: 'object', properties: { focus: { type: 'string', description: 'Optional section to keep, e.g. "fees", "keys", "NFT"' } } },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'mirror_node_query',
    title: 'Read Hedera state',
    description: 'Live read from the public Mirror Node (free): accounts, tokens, topics (with decoded messages), transactions, contracts, schedules, balances, exchange rate, gas prices, nodes, blocks. Upstream HTTP errors and timeouts return isError; follow links.next with the next argument.',
    inputSchema: {
      type: 'object',
      required: ['endpoint'],
      properties: {
        endpoint: { type: 'string', enum: Object.keys(MIRROR_ROUTES) },
        id: { type: 'string', description: 'Entity ID (0.0.123), EVM address (0x…) or transaction ID; not needed for network/*, balances, blocks' },
        sub: { type: 'string', description: 'Sub-resource: accounts → tokens | nfts | allowances/crypto | allowances/tokens | rewards; tokens → nfts | balances; topics → messages; contracts → results | state' },
        network: { type: 'string', enum: ['testnet', 'mainnet', 'previewnet'], description: 'Default "testnet"' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        next: { type: 'string', description: 'Pagination: the relative links.next value (/api/v1/…) returned by a previous call for the same endpoint/id/sub/network' },
        order: { type: 'string', enum: ['asc', 'desc'] }
      }
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: 'estimate_cost',
    title: 'Estimate HBAR cost',
    description: 'Price a set of Hedera operations in USD and in HBAR at the live exchange rate (and gas at the live gas price times the gas limit you give; without gas, contract totals are marked incomplete).',
    inputSchema: {
      type: 'object',
      required: ['operations'],
      properties: {
        operations: { type: 'array', items: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: Object.keys(FEES_USD) }, count: { type: 'integer', minimum: 1 }, gas: { type: 'integer', minimum: 1, maximum: 15000000, description: 'Gas limit, for contract_create / contract_call (without it the total excludes gas and is marked incomplete)' } } } },
        network: { type: 'string', enum: ['testnet', 'mainnet'], description: 'Default "testnet"' }
      }
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: 'query_knowledge',
    title: 'Hedera ecosystem map',
    description: 'Curated map of Hedera studios, SDKs, standards and solutions (AI agents, RWA/ATS, stablecoins, DePIN, identity, privacy) with official links.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string' }, audience: { type: 'string', enum: ['developer', 'architect', 'business', 'founder'] } } },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: 'official_resources',
    title: 'Official links',
    description: 'Official Hedera documentation, repositories and specifications.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }
]

function handleSearchLabs (p: any = {}) {
  const lang = langOf(p.lang)
  if (!String(p.query || '').trim()) throw new InvalidParams('query is required')
  const hits = searchLabs({ ...p, lang })
  if (!hits.length) return `No lab matches "${p.query}". Try SDK class names (TokenCreateTransaction), standards (HCS-10, HIP-991) or list_labs.`
  return `${lang === 'es' ? 'Labs para' : 'Labs for'} "${p.query}" (${lang}):\n\n${hits.map((h: any) => summaryLine(h, lang)).join('\n\n')}`
}

function handleGetLab (p: any = {}) {
  const lang = langOf(p.lang)
  const slug = String(p.slug || '').trim()
  const md = slug && labMarkdown(slug, lang, { includeCode: p.include_code !== false })
  if (!md) throw new InvalidParams(`unknown lab "${slug}". Use search_labs or list_labs to find slugs.`)
  return md
}

function handleListLabs (p: any = {}) {
  const lang = langOf(p.lang)
  const idx = indexData as any
  if (!idx?.modules) return 'Course content not found.'
  const mod = p.module ? String(p.module).toUpperCase().replace(/^M?/, 'M') : null
  return idx.modules.filter((m: any) => !mod || moduleId(m) === mod).map((m: any) => [
    `## ${moduleId(m)} — ${m[lang]?.title || m.en.title}`,
    ...m.labs.map((l: any) => `- ${l.n} ${(l[lang] || l.en).title} — \`${l.slug}\``)
  ].join('\n')).join('\n\n') || `No module ${p.module}.`
}

function handleQueryCurriculum (p: any = {}) {
  const lang = langOf(p.lang)
  if (!String(p.query || '').trim()) throw new InvalidParams('query is required (e.g. "TokenCreateTransaction", "HCS-10", "x402")')
  const hits = searchLabs({ query: p.query || '', module: p.module, lang, limit: Math.min(Number(p.limit) || 3, 5) })
  if (!hits.length) return `No labs found matching query: "${p.query || ''}" in language "${lang}". Try SDK classes like "PrivateKey", "TopicMessageSubmitTransaction" or "TransferTransaction".`
  return hits.map((h: any) => labMarkdown(h.lab.slug, lang)).join('\n\n---\n\n')
}

function handleQueryKnowledge (p: any = {}) {
  const catalog = catalogData as any
  if (!catalog?.resources) return 'Knowledge catalog not found.'
  let results = catalog.resources
  if (p.category) results = results.filter((r: any) => norm(r.category).includes(norm(p.category)))
  if (p.audience) results = results.filter((r: any) => (r.audience || []).includes(String(p.audience).toLowerCase()))
  const words = tokens(p.query)
  if (words.length) {
    results = results.map((r: any) => {
      const hay = norm([r.name, r.summary, r.technicalStack, ...(r.searchTriggers || [])].join(' '))
      return { r, s: words.filter((w) => hay.includes(w)).length }
    }).filter((x: any) => x.s).sort((a: any, b: any) => b.s - a.s).map((x: any) => x.r)
  }
  if (!results.length) {
    // Fall back to the official resources table (docs, explorers, repos) before giving up.
    const fallback = words.length ? handleOfficialResources({ query: p.query }) : ''
    const rows = fallback.split('\n').filter((l: string) => l.startsWith('|') && !l.startsWith('| Resource') && !l.startsWith('| :---'))
    if (rows.length) return `No ecosystem entry matches "${p.query}". Closest official resources:\n\n| Resource Name | Category | Official URL | Purpose / Coverage | Last Verified Update |\n| :--- | :--- | :--- | :--- | :---: |\n${rows.join('\n')}`
    return `Nothing matches "${p.query || p.category}". Categories: ${(catalog.categories || []).join(', ')}.`
  }
  return results.slice(0, 5).map((r: any) => `### ${r.name}
- **Category:** ${r.category} (${r.layer})
- **Summary:** ${r.summary}
- **Business value:** ${r.businessValue}
- **Tech stack:** ${r.technicalStack}
- **Links:** ${Object.entries(r.urls || {}).map(([k, v]) => `[${k}](${v})`).join(' | ')}
- **Watch out:** ${r.antiHallucinationNotes}`).join('\n\n')
}

function handleArchitecture (p: any = {}) {
  const doc = ARCHITECTURE_DOC
  if (!p.focus) return doc
  const parts: string[] = doc.split(/\n(?=#{2,3} )/)
  const titleOf = (s: string) => s.split('\n')[0].replace(/^#+\s*/, '').trim()
  const words = tokens(p.focus)
  const phrase = norm(p.focus).trim()
  const stem = (w: string) => w.replace(/(ies|es|s)$/, '')
  const hasWord = (text: string, w: string) => text.includes(w) || (stem(w).length > 2 && text.includes(stem(w)))
  const sections = parts.slice(1).map((s) => ({ s, title: norm(titleOf(s)), body: norm(s) }))
  const available = parts.slice(1).map((s) => `- ${titleOf(s)}`).join('\n')
  if (!words.length) return `No section matches "${p.focus}". Available sections:\n${available}`
  const byTitle = sections.filter((x) => x.title.includes(phrase) || words.every((w) => hasWord(x.title, w)))
  let keep = byTitle
  if (!keep.length) {
    keep = sections
      .map((x) => ({ ...x, n: words.reduce((a, w) => a + (x.body.split(w).length - 1), 0), all: words.every((w) => hasWord(x.body, w)) }))
      .filter((x) => x.all && x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 4)
  }
  if (!keep.length) return `No section of the architecture guide matches "${p.focus}". Available sections (use a word from a title as focus, e.g. "fees", "keys", "NFT", "HCS"):\n${available}`
  return `Sections matching "${p.focus}" (${keep.length}):\n\n${keep.map((x) => x.s.trim()).join('\n\n')}`
}

function handleOfficialResources (p: any = {}) {
  const doc = RESOURCES_DOC
  const words = tokens(p.query)
  if (!words.length) return doc
  const all = doc.split('\n')
  const rows = all.filter((l: string) => l.startsWith('|') && !l.startsWith('| Resource') && !l.startsWith('| :---'))
  const hits = rows.filter((l: string) => words.some((w) => norm(l).includes(w)))
  if (!hits.length) {
    const cats = [...new Set(rows.map((l: string) => (l.split('|')[2] || '').replace(/\*/g, '').trim()).filter(Boolean))]
    return `No official resource matches "${p.query}". Categories: ${cats.join(', ')}. Try a product or topic such as "mirror node", "faucet", "HashScan", "SDK" or "HIP".`
  }
  const header = all.filter((l: string) => l.startsWith('| Resource') || l.startsWith('| :---')).slice(0, 2)
  return [`Official resources matching "${p.query}" (${hits.length}):`, '', ...header, ...hits].join('\n')
}

export async function callTool (name: string, args: any = {}) {
  switch (name) {
    case 'search_labs': return handleSearchLabs(args)
    case 'get_lab': return handleGetLab(args)
    case 'list_labs': return handleListLabs(args)
    case 'query_curriculum': return handleQueryCurriculum(args)
    case 'anti_hallucination_rules': return GUARDRAILS
    case 'architecture_decision_tree': return handleArchitecture(args)
    case 'mirror_node_query': return handleMirrorNodeQuery(args)
    case 'estimate_cost': return handleEstimateCost(args)
    case 'query_knowledge': return handleQueryKnowledge(args)
    case 'official_resources': return handleOfficialResources(args)
    default: return undefined
  }
}

const DOC_RESOURCES = [
  { uri: 'hbe://guide/guardrails', name: 'guardrails', title: 'Hedera guardrails for coding agents', mimeType: 'text/markdown', read: () => GUARDRAILS },
  { uri: 'hbe://guide/architecture', name: 'architecture', title: 'Architecture decision tree & guardrails', mimeType: 'text/markdown', read: () => ARCHITECTURE_DOC },
  { uri: 'hbe://guide/official-resources', name: 'official-resources', title: 'Official Hedera resources', mimeType: 'text/markdown', read: () => RESOURCES_DOC },
  { uri: 'hbe://guide/hackathon', name: 'hackathon', title: 'Hackathon rules and guidelines', mimeType: 'text/markdown', read: () => HACKATHON_DOC },
  { uri: 'hbe://labs/en', name: 'labs-en', title: 'Course map (English)', mimeType: 'text/markdown', read: () => handleListLabs({ lang: 'en' }) },
  { uri: 'hbe://labs/es', name: 'labs-es', title: 'Mapa del curso (español)', mimeType: 'text/markdown', read: () => handleListLabs({ lang: 'es' }) }
]

function listResources () {
  const labs = labCatalog().flatMap(({ module: m, lab }: any) => ['en', 'es'].map((lang) => ({
    uri: `hbe://lab/${lang}/${lab.slug}`,
    name: `${lab.slug}-${lang}`,
    title: `${moduleId(m)} Lab ${lab.n} — ${(lab[lang] || lab.en).title} (${lang})`,
    mimeType: 'text/markdown'
  })))
  return [...DOC_RESOURCES.map(({ read, ...r }) => r), ...labs]
}

function readResource (uri: string) {
  const doc = DOC_RESOURCES.find((r) => r.uri === uri)
  if (doc) return doc.read()
  const m = String(uri).match(/^hbe:\/\/lab\/(en|es)\/([a-z0-9-]+)$/)
  return m ? labMarkdown(m[2], m[1] as any) : null
}

const PROMPTS = [
  { name: 'build_on_hedera', title: 'Build a feature on Hedera', description: 'Plan and write Hedera code for a goal, grounded in the course labs and the guardrails.', arguments: [{ name: 'goal', description: 'What you want to build', required: true }, { name: 'lang', description: 'en or es', required: false }] },
  { name: 'explain_lab', title: 'Explain a lab', description: 'Walk through one lab step by step, with what it needs and what it costs.', arguments: [{ name: 'slug', description: 'Lab slug, e.g. m04-04-atomic-swaps', required: true }, { name: 'lang', description: 'en or es', required: false }] },
  { name: 'review_hedera_code', title: 'Review Hedera code', description: 'Review code against the Hedera guardrails (units, fees, gas, keys, limits, Mirror Node use).', arguments: [{ name: 'code', description: 'The code to review', required: true }] }
]

function getPrompt (name: string, args: any = {}) {
  const lang = langOf(args.lang)
  const user = (text: string) => ({ role: 'user', content: { type: 'text', text } })
  if (name === 'build_on_hedera') {
    if (!args.goal) throw new InvalidParams('goal is required')
    const labs = searchLabs({ query: args.goal, lang, limit: 4 })
    return {
      description: `Build on Hedera: ${args.goal}`,
      messages: [user(`${GUARDRAILS}\n\n# Labs from Hedera by Example that cover this\n${labs.map((h: any) => summaryLine(h, lang)).join('\n\n') || '(none matched; use search_labs)'}\n\n# Task\nGoal: ${args.goal}\n\nPick the right services (HCS, HTS, smart contracts), say which lab patterns you reuse (get_lab gives their code), estimate the HBAR cost with estimate_cost, then write the code with @hiero-ledger/sdk. Follow every guardrail above.`)]
    }
  }
  if (name === 'explain_lab') {
    const md = labMarkdown(String(args.slug || ''), lang)
    if (!md) throw new InvalidParams(`unknown lab "${args.slug}"`)
    return { description: `Explain ${args.slug}`, messages: [user(`${md}\n\nExplain this lab step by step for a learner${lang === 'es' ? ', in Spanish' : ''}: the concept, what each step of the code does and why, what it needs before running, what it costs, and what to try next.`)] }
  }
  if (name === 'review_hedera_code') {
    if (!args.code) throw new InvalidParams('code is required')
    return { description: 'Review Hedera code', messages: [user(`${GUARDRAILS}\n\n# Code to review\n\`\`\`javascript\n${args.code}\n\`\`\`\n\nReview this code against every guardrail above. List concrete problems (with line references and the fix), then anything that wastes HBAR.`)] }
  }
  return null
}

const INSTRUCTIONS = `Hedera by Example: 131 runnable Hedera labs (English/Spanish) built on @hiero-ledger/sdk, plus verified guardrails.
Start with search_labs (or list_labs), read a lab with get_lab, check anti_hallucination_rules before writing Hedera code, price operations with estimate_cost, and read live state with mirror_node_query. Every lab also runs in the browser at ${WEB}.`

const rpcError = (id: any, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const rpcResult = (id: any, result: any) => ({ jsonrpc: '2.0', id, result })

/**
 * Per-request context from the HTTP route. sessionId / ip / userAgent identify the caller for
 * analytics; newSessionId is set by `initialize` so the route returns it as Mcp-Session-Id.
 */
export type McpContext = { sessionId?: string | null, ip?: string | null, userAgent?: string | null, newSessionId?: string }

export async function dispatchOneMcp (msg: any, ctx: McpContext = {}) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return rpcError(msg?.id, -32600, 'Invalid Request')
  const { id, method, params = {} } = msg
  const isNotification = id === undefined || id === null
  if (method === undefined) return null
  if (isNotification) return null
  try {
    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion
        const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0]
        // One session per connection: the route returns it as Mcp-Session-Id and compliant
        // clients send it back on every request (MCP Streamable HTTP transport).
        const sessionId = createSessionId(params.clientInfo || {})
        ctx.newSessionId = sessionId
        runAnalyticsSilently(async () => recordMcpSessionStarted(await identifyCaller({ ...ctx, sessionId }), protocolVersion))
        return rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false } },
          serverInfo: { name: 'hedera-by-example-mcp', title: 'Hedera by Example', version: VERSION },
          instructions: INSTRUCTIONS
        })
      }
      case 'ping': return rpcResult(id, {})
      case 'tools/list': return rpcResult(id, { tools: TOOLS })
      case 'tools/call': {
        const name = params.name
        if (!TOOLS.some((t) => t.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`)
        const args = params.arguments || {}
        const started = Date.now()
        // Fire-and-forget: analytics never delays or fails a tool call.
        const track = (isError: boolean) => {
          const durationMs = Date.now() - started
          runAnalyticsSilently(async () => recordMcpToolCall({
            caller: await identifyCaller(ctx),
            tool: name,
            isError,
            durationMs,
            labSlug: typeof args.slug === 'string' ? args.slug.slice(0, 80) : undefined,
            queryLength: typeof args.query === 'string' ? args.query.length : undefined
          }))
        }
        try {
          const text = await callTool(name, args)
          void track(false)
          return rpcResult(id, { content: [{ type: 'text', text: String(text) }] })
        } catch (err: any) {
          void track(true)
          return rpcResult(id, { isError: true, content: [{ type: 'text', text: err instanceof InvalidParams ? `Invalid arguments: ${err.message}` : err instanceof UpstreamError ? err.message : `Tool error: ${err.message}` }] })
        }
      }
      case 'resources/list': return rpcResult(id, { resources: listResources() })
      case 'resources/templates/list': return rpcResult(id, { resourceTemplates: [{ uriTemplate: 'hbe://lab/{lang}/{slug}', name: 'lab', title: 'A lab (lang: en | es)', mimeType: 'text/markdown' }] })
      case 'resources/read': {
        const text = readResource(params.uri)
        if (text == null) return rpcError(id, -32002, `Resource not found: ${params.uri}`)
        return rpcResult(id, { contents: [{ uri: params.uri, mimeType: 'text/markdown', text }] })
      }
      case 'prompts/list': return rpcResult(id, { prompts: PROMPTS })
      case 'prompts/get': {
        const prompt = getPrompt(params.name, params.arguments || {})
        if (!prompt) return rpcError(id, -32602, `Unknown prompt: ${params.name}`)
        return rpcResult(id, prompt)
      }
      default: return rpcError(id, -32601, `Method not found: ${method}`)
    }
  } catch (err: any) {
    return rpcError(id, err instanceof InvalidParams ? -32602 : -32603, err.message)
  }
}

export async function dispatchMcpRpc (payload: any, ctx: McpContext = {}) {
  if (Array.isArray(payload)) {
    if (!payload.length) return rpcError(null, -32600, 'Invalid Request: empty batch')
    const out = (await Promise.all(payload.map((p: any) => dispatchOneMcp(p, ctx)))).filter(Boolean)
    return out.length ? out : null
  }
  return dispatchOneMcp(payload, ctx)
}

export function getMcpMetadata () {
  return {
    status: 'online',
    server: 'hedera-by-example-mcp',
    version: VERSION,
    protocols: SUPPORTED_PROTOCOLS,
    tools: TOOLS.length,
    endpoints: {
      streamableHttp: '/api/mcp',
      directUrl: `${WEB}/api/mcp`,
      manifest: `${WEB}/mcp/manifest.json`,
      tools: `${WEB}/mcp/tools.json`
    }
  }
}
