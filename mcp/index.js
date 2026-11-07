#!/usr/bin/env node
/**
 * ============================================================================
 * Hedera by Example (HBE) — Model Context Protocol (MCP) server
 * ============================================================================
 * Gives AI coding assistants (Claude Code, Claude Desktop, Cursor, VS Code,
 * Windsurf, ...) the 131 runnable labs of the course (English and Spanish),
 * verified Hedera guardrails, live Mirror Node reads and fee estimates.
 *
 * Protocol: MCP over JSON-RPC 2.0, versions 2025-06-18, 2025-03-26 and
 * 2024-11-05 (negotiated). Capabilities: tools, resources, prompts.
 * Transports:
 *   - stdio (default): newline-delimited JSON-RPC.
 *   - HTTP (--http [port]): Streamable HTTP at POST /mcp (JSON responses),
 *     plus the legacy HTTP+SSE transport at GET /sse + POST /messages.
 *     Binds 127.0.0.1 unless --host is given; browser Origins other than
 *     localhost are refused unless listed with --allow-origin.
 * No npm dependencies: Node.js 20+ only.
 * ============================================================================
 */

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import readline from 'node:readline'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const VERSION = '2.0.0'
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const WEB = 'https://hbe.expo.app'
const REPO = 'https://github.com/altaga/Hedera-By-Example'
const MIRROR = {
  testnet: 'https://testnet.mirrornode.hedera.com',
  mainnet: 'https://mainnet-public.mirrornode.hedera.com',
  previewnet: 'https://previewnet.mirrornode.hedera.com'
}

// ============================================================================
// DATA
// ============================================================================

const PATHS = {
  catalog: path.join(__dirname, 'data', 'hedera_master_catalog.json'),
  architecture: path.join(ROOT, 'docs', 'HEDERA_ARCHITECTURE_AND_GUARDRAILS.md'),
  hackathon: path.join(ROOT, 'docs', 'HACKATHON_RULES_AND_GUIDELINES.md'),
  resources: path.join(ROOT, 'docs', 'OFFICIAL_HEDERA_RESOURCES.md'),
  index: path.join(ROOT, 'app', 'src', 'content', 'index.json'),
  en: path.join(ROOT, 'app', 'src', 'content', 'en.json'),
  es: path.join(ROOT, 'app', 'src', 'content', 'es.json')
}

const cache = {}
const readText = (key) => {
  if (!(key in cache)) cache[key] = fs.existsSync(PATHS[key]) ? fs.readFileSync(PATHS[key], 'utf8') : null
  return cache[key]
}
const readJson = (key) => {
  const k = `json:${key}`
  if (!(k in cache)) {
    try { cache[k] = JSON.parse(readText(key) || 'null') } catch (_) { cache[k] = null }
  }
  return cache[k]
}

const LANG_DIR = { en: 'English', es: 'Spanish' }
const langOf = (v) => (v === 'es' ? 'es' : 'en')

/** Every lab with its module, in course order. */
function labCatalog () {
  const index = readJson('index')
  if (!index) return []
  return index.modules.flatMap((m) => m.labs.map((l) => ({ module: m, lab: l })))
}

function labBody (slug, lang) {
  const store = readJson(lang)
  return store ? store[slug] || readJson('en')?.[slug] || null : null
}

const labCode = (body) => body.segments.map((s) => s.code).filter(Boolean).join('\n\n')
const moduleId = (m) => `M${m.n}`

/** "M9", "m09", "9" and "09" all mean M9 (lab slugs use the zero-padded form, m09-01-...). */
const normalizeModule = (value) => {
  if (value == null || value === '') return null
  const n = parseInt(String(value).replace(/^m/i, ''), 10)
  return Number.isNaN(n) ? String(value).toUpperCase() : `M${n}`
}

/** Markdown for one lab: what it teaches, what it needs, and its code. */
function labMarkdown (slug, lang, { includeCode = true } = {}) {
  const entry = labCatalog().find((e) => e.lab.slug === slug)
  const body = labBody(slug, lang)
  if (!entry || !body) return null
  const { module: m, lab } = entry
  const meta = lab[lang] || lab.en
  const out = [
    `# ${moduleId(m)} Lab ${lab.n}: ${body.title || meta.title}`,
    `*${m[lang]?.title || m.en.title}* · \`${slug}\``,
    '',
    body.kicker ? `**Concept:** ${body.kicker}` : '',
    ...(body.concept || []).map((p) => p),
    body.moment ? `**Learnable moment:** ${body.moment}` : ''
  ]
  if (body.before?.length) {
    out.push('', lang === 'es' ? '## Antes de ejecutar' : '## Before you run')
    for (const b of body.before) out.push(`- ${b.label ? `**${b.label}:** ` : ''}${b.text}`)
  }
  if (body.sdk?.length) out.push('', `**SDK classes:** ${body.sdk.map((s) => `\`${s}\``).join(', ')}`)
  if (body.simulated) out.push('', `**Simulated in this lab:** ${body.simulated}`)
  out.push('', `**Run it in the browser:** ${WEB}/#${slug}`,
    `**Source:** ${REPO}/blob/master/course/${LANG_DIR[lang]}/${m.dir}/${lab.file}`,
    `**Run locally:** \`cd course && npm ci && node ${LANG_DIR[lang]}/${m.dir}/${lab.file}\` (needs a \`.env\` with OPERATOR_ID and OPERATOR_PRIVATE_KEY)`)
  if (body.refs?.length) out.push('', '**Official references:**', ...body.refs.map((r) => `- ${r}`))
  if (includeCode) out.push('', '## Code', '```javascript', labCode(body), '```')
  return out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')
}

// ---------- search ----------

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'how', 'do', 'i', 'is', 'el', 'la', 'los', 'las', 'de', 'del', 'en', 'un', 'una', 'y', 'o', 'con', 'como', 'para', 'por', 'que'])
const tokens = (q) => String(q || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9.]+/).filter((t) => t.length > 1 && !STOP.has(t))
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Ranks labs for a free-text query: every word counts, SDK class names and titles count most. */
function searchLabs ({ query = '', lang = 'en', module, limit = 5 } = {}) {
  const words = tokens(query)
  const modFilter = normalizeModule(module)
  const scored = []
  for (const { module: m, lab } of labCatalog()) {
    if (modFilter && moduleId(m) !== modFilter) continue
    const body = labBody(lab.slug, lang)
    if (!body) continue
    const fields = {
      title: norm(`${body.title} ${lab.en.title} ${lab.slug}`),
      kicker: norm(body.kicker),
      sdk: (body.sdk || []).map(norm),
      text: norm([...(body.concept || []), body.moment].join(' ')),
      docs: norm(body.segments.flatMap((s) => s.doc || []).join(' ')),
      code: norm(labCode(body))
    }
    let score = words.length ? 0 : 1
    let hits = 0
    for (const w of words) {
      let s = 0
      if (fields.sdk.some((c) => c === w)) s += 8
      else if (fields.sdk.some((c) => c.includes(w))) s += 4
      if (fields.title.includes(w)) s += 5
      if (fields.kicker.includes(w)) s += 3
      if (fields.text.includes(w)) s += 2
      if (fields.docs.includes(w)) s += 1.5
      if (fields.code.includes(w)) s += 1
      if (s) hits++
      score += s
    }
    if (words.length && hits === 0) continue
    if (words.length > 1) score *= 0.5 + hits / words.length // reward labs that match every word
    scored.push({ score, module: m, lab, body })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(1, Math.min(Number(limit) || 5, 20)))
}

const summaryLine = ({ module: m, lab, body }, lang) => {
  const cost = (body.before || []).find((b) => /cost|costo/i.test(b.label))
  const first = (body.before || []).find((b) => /run first|ejecuta antes/i.test(b.label))
  return [`- **${moduleId(m)} Lab ${lab.n} — ${body.title}** (\`${lab.slug}\`)`,
    body.kicker ? `  ${body.kicker}` : '',
    body.sdk?.length ? `  SDK: ${body.sdk.slice(0, 8).join(', ')}` : '',
    first ? `  ${first.label}: ${first.text}` : '',
    cost ? `  ${cost.label}: ${cost.text}` : '',
    `  ${WEB}/#${lab.slug}`].filter(Boolean).join('\n')
}

// ============================================================================
// VERIFIED GUARDRAILS
// ============================================================================

const GUARDRAILS = `# Hedera guardrails for coding agents (@hiero-ledger/sdk)
Each rule was checked against the SDK and testnet while building this course.

## Units and money
1. **8 decimals.** 1 HBAR = 100,000,000 tinybars (10^8), not 10^18. \`new Hbar(1)\` = 100_000_000 tinybars; \`Hbar.fromTinybars(n)\` goes the other way.
2. **Hbar arithmetic.** \`Hbar\` has \`toTinybars()\`, \`to(unit)\`, \`negated()\`, \`isNegative()\` and \`toBigNumber()\`, but **no** \`plus()\` / \`minus()\`: add and subtract in tinybars (Long/BigInt), then build a new \`Hbar\`.
3. **JSON-RPC uses weibars.** Through the relay (Hashio, chain IDs 295 mainnet / 296 testnet) values are 18-decimal "weibars": 1 tinybar = 10^10 weibar. Ask the relay for \`eth_gasPrice\`; EIP-1559 estimates from fee history can come out below its minimum.

## Fees and gas
4. **Fees are fixed in USD and paid in HBAR** at the network exchange rate: about $0.0001 per HBAR transfer or HCS message, $0.001 per token transfer, $0.05 per account creation or token association, $1 per token creation ($2 with custom fees), $2 per HIP-991 topic with custom fees, $1 + gas per contract deployment. Use the \`estimate_cost\` tool for today's HBAR amounts.
5. **Set a realistic gas limit.** Since HIP-1249 only the gas actually used is charged (the old 80%-of-limit minimum is gone), but the limit reserves throttle capacity and one too low fails with INSUFFICIENT_GAS and still pays for the gas used. Estimate first with the Mirror Node (\`POST /api/v1/contracts/call\` with \`estimate: true\`, free) and add ~25%. Max gas per transaction: 15,000,000 (INDIVIDUAL_TX_GAS_LIMIT_EXCEEDED above it). Simulations of system contracts (HTS 0x167, HSS 0x16b) can be far above the real use.

## Accounts and keys
6. **Raw 32-byte private keys are ambiguous**: the same hex fits ECDSA (secp256k1) and Ed25519. Prefer DER (\`302e\u2026\` Ed25519, \`3030\u2026\` ECDSA), or \`PrivateKey.fromStringECDSA()\` / \`fromStringED25519()\` explicitly. Guessing the curve gives INVALID_SIGNATURE.
7. **Two EVM addresses.** Every account has a long-zero address (0x000\u2026<account number>); ECDSA accounts created from an EVM address also have an alias (keccak of the public key). Send to and verify against the one the account actually uses (Mirror Node \`/accounts/{id}\` \u2192 \`evm_address\`).
8. **Lazy creation.** Sending HBAR to an unused ECDSA EVM address creates the account (HIP-583); the receiver's key signs nothing until it spends.
9. **Associations.** An account can hold a token only after associating it, or through free auto-association slots. HIP-904 airdrops arrive at once when a slot is free and stay pending (claim/cancel/reject) otherwise. Associating twice fails with TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT.

## Data limits
10. **NFT metadata: 100 bytes.** Store a URI/CID (ipfs://\u2026), not the JSON (METADATA_TOO_LONG otherwise).
11. **Memos: 100 bytes** for transaction, account, token and topic memos.
12. **HCS messages: 1,024 bytes per chunk.** \`TopicMessageSubmitTransaction\` chunks larger messages (SDK \`CHUNK_SIZE\` 1024, \`maxChunks\` 20 by default, so ~20 KB unless raised; each chunk is its own paid transaction). A whole transaction, signatures included, is capped at 6,144 bytes (https://docs.hedera.com/hedera/sdks-and-apis/sdks/transactions).
13. **HFS files: ~4 KB per transaction.** Create with the first chunk, then \`FileAppendTransaction\`; storage is billed by size and lifetime.

## Reading state
14. **Read from the Mirror Node, not consensus nodes.** \`AccountBalanceQuery\` is deprecated in @hiero-ledger/sdk (its consensus-node endpoint \`cryptoGetBalance\` was removed) and \`AccountInfoQuery\` is a paid query; use \`MirrorNodeAccountBalanceQuery\` or the REST API (\`/api/v1/...\`). Reads are free but **a few seconds behind consensus**: poll until a new entity appears.
15. **Receipts vs records.** \`getReceipt()\` gives status and new IDs (free); \`getRecord()\` adds transfers, fees and contract results (paid query).
16. **Public Mirror Nodes are rate-limited** per IP: back off on HTTP 429 and avoid bursts.

## Scheduling and keys
17. **Scheduled transactions** wait until every required key signs or they expire (HIP-423 allows a custom expiry and \`waitForExpiry\`). A KeyList with a threshold needs M of N signatures.

Sources: https://docs.hedera.com \xB7 https://hedera.com/fees \xB7 https://hips.hedera.com \xB7 ${WEB}`;
const ID_RE = /^(\d+\.\d+\.\d+(-[a-z]{5})?|0x[0-9a-fA-F]{40}|\d+\.\d+\.\d+-\d+-\d+|\d+\.\d+\.\d+@\d+\.\d+)$/;
const MIRROR_ROUTES = {
  accounts: ["", "tokens", "nfts", "allowances/crypto", "allowances/tokens", "rewards"],
  tokens: ["", "nfts", "balances"],
  topics: ["", "messages"],
  transactions: [""],
  contracts: ["", "results", "state"],
  schedules: [""],
  balances: null,
  "network/exchangerate": null,
  "network/fees": null,
  "network/supply": null,
  "network/nodes": null,
  blocks: null
};
const decode64 = (s) => {
  try {
    return Buffer.from(s, "base64").toString("utf8");
  } catch (_) {
    return s;
  }
};
class UpstreamError extends Error {
}
const MIRROR_NETWORKS = ["testnet", "mainnet", "previewnet"];
const MIRROR_TIMEOUT_MS = 1e4;
function requireNetwork(network, allowed) {
  const n = network === void 0 || network === null ? "testnet" : network;
  if (typeof n !== "string" || !allowed.includes(n)) throw new InvalidParams(`network must be one of: ${allowed.join(", ")} (lowercase; got ${JSON.stringify(network)})`);
  return n;
}
async function mirrorGet(network, apiPath) {
  const base = MIRROR[network];
  if (!base) throw new InvalidParams(`network must be one of: ${MIRROR_NETWORKS.join(", ")}`);
  const url = `${base}/api/v1/${apiPath}`;
  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return { url, ok: false, status: 0, data: null, text: timedOut ? `timed out after ${MIRROR_TIMEOUT_MS / 1e3}s` : `request failed (${err?.message || "network error"})` };
  }
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
  }
  return { url, ok: res.ok, status: res.status, data, text };
}
const describeFailure = (r) => `Mirror Node ${r.status ? `answered HTTP ${r.status}` : "request failed"} for ${r.url}
${r.text.slice(0, 500)}`;
const NEXT_QS_RE = /^[A-Za-z0-9_.:=&%-]*$/;
function validateNext(next, basePath) {
  if (typeof next !== "string" || next.length > 600) throw new InvalidParams("next must be the relative links.next string returned by a previous call");
  const prefix = `/api/v1/${basePath}?`;
  if (!next.startsWith(prefix)) throw new InvalidParams(`next must start with ${prefix} (same endpoint, id and sub as this call)`);
  const qs = next.slice(prefix.length);
  if (!qs || !NEXT_QS_RE.test(qs) || qs.includes("..")) throw new InvalidParams("next contains characters that are not allowed");
  return next.slice("/api/v1/".length);
}
async function handleMirrorNodeQuery({ endpoint, id, sub = "", network, limit, order, next } = {}) {
  const net = requireNetwork(network, MIRROR_NETWORKS);
  if (!(endpoint in MIRROR_ROUTES)) throw new InvalidParams(`endpoint must be one of: ${Object.keys(MIRROR_ROUTES).join(", ")}`);
  const subs = MIRROR_ROUTES[endpoint];
  let apiPath = endpoint;
  if (subs) {
    if (!id || !ID_RE.test(String(id).trim())) throw new InvalidParams("id must be a Hedera ID (0.0.123), an EVM address (0x\u2026) or a transaction ID");
    if (!subs.includes(sub)) throw new InvalidParams(`sub for ${endpoint} must be one of: ${subs.map((s) => s || "(none)").join(", ")}`);
    apiPath += `/${encodeURIComponent(String(id).trim())}${sub ? `/${sub}` : ""}`;
  }
  if (next !== void 0 && next !== null && next !== "") {
    apiPath = validateNext(next, apiPath);
  } else {
    const qs = new URLSearchParams();
    if (limit !== void 0 && limit !== null) {
      if (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100) throw new InvalidParams(`limit must be an integer from 1 to 100 (got ${JSON.stringify(limit)})`);
      qs.set("limit", String(Number(limit)));
    }
    if (order === "asc" || order === "desc") qs.set("order", order);
    if (endpoint === "accounts" && !sub) qs.set("transactions", "false");
    if ([...qs].length) apiPath += `?${qs}`;
  }
  const r = await mirrorGet(net, apiPath);
  if (!r.ok) throw new UpstreamError(describeFailure(r));
  const data = r.data;
  if (endpoint === "topics" && sub === "messages" && Array.isArray(data?.messages)) {
    for (const m of data.messages) m.message_decoded = decode64(m.message);
  }
  let json = JSON.stringify(data, null, 2);
  if (json.length > 2e4) json = json.slice(0, 2e4) + "\n\u2026 (truncated; use limit to read less)";
  const nextLink = typeof data?.links?.next === "string" ? data.links.next : null;
  return `### Mirror Node (${net}) \u2014 ${r.url}
\`\`\`json
${json}
\`\`\`` + (nextLink ? `

More results: call again with the same endpoint/id/sub/network and next = "${nextLink}"` : "");
}
const FEES_USD = {
  hbar_transfer: [1e-4, "HBAR transfer (CryptoTransfer)"],
  token_transfer: [1e-3, "HTS token transfer"],
  account_create: [0.05, "Account creation"],
  account_update: [22e-5, "Account update"],
  allowance_approve: [0.05, "Allowance approval"],
  token_create: [1, "Token creation"],
  token_create_custom_fees: [2, "Token creation with custom fees"],
  token_associate: [0.05, "Token association"],
  token_mint_ft: [1e-3, "Fungible token mint"],
  nft_mint: [0.02, "NFT mint (per serial)"],
  token_airdrop: [0.1, "HIP-904 airdrop"],
  topic_create: [0.01, "Topic creation"],
  topic_create_custom_fees: [2, "HIP-991 topic with custom fees"],
  topic_message: [1e-4, "HCS message (small)"],
  schedule_create: [0.01, "Scheduled transaction"],
  schedule_sign: [1e-3, "Schedule signature"],
  file_create: [0.05, "File creation (plus size/lifetime)"],
  file_append: [0.05, "File append (plus size/lifetime)"],
  contract_create: [1, "Contract deployment (plus gas)"],
  contract_call: [0, "Contract call (gas only)"]
};
async function handleEstimateCost({ operations = [], network } = {}) {
  const net = requireNetwork(network, ["testnet", "mainnet"]);
  if (!Array.isArray(operations) || operations.length === 0) throw new InvalidParams(`operations must list items like { "type": "token_create", "count": 1 }. Types: ${Object.keys(FEES_USD).join(", ")}`);
  const ops = operations.map((op) => {
    const fee = FEES_USD[op?.type];
    if (!fee) throw new InvalidParams(`unknown operation type "${op?.type}". Types: ${Object.keys(FEES_USD).join(", ")}`);
    const count = op.count === void 0 || op.count === null ? 1 : Number(op.count);
    if (!Number.isInteger(count) || count < 1) throw new InvalidParams(`count for "${op.type}" must be a positive integer (got ${JSON.stringify(op.count)})`);
    const isContract = op.type === "contract_create" || op.type === "contract_call";
    let gas = null;
    if (op.gas !== void 0 && op.gas !== null) {
      if (!isContract) throw new InvalidParams(`gas only applies to contract_create / contract_call (got it on "${op.type}")`);
      gas = Number(op.gas);
      if (!Number.isInteger(gas) || gas < 1 || gas > 15e6) throw new InvalidParams(`gas for "${op.type}" must be an integer from 1 to 15,000,000 (got ${JSON.stringify(op.gas)})`);
    }
    return { type: op.type, fee, count, isContract, gas };
  });
  const needsGas = ops.some((o) => o.isContract && o.gas);
  const [rate, fees] = await Promise.all([mirrorGet(net, "network/exchangerate"), needsGas ? mirrorGet(net, "network/fees") : Promise.resolve(null)]);
  const cr = rate.ok ? rate.data?.current_rate : null;
  const usdPerHbar = cr && cr.hbar_equivalent ? cr.cent_equivalent / cr.hbar_equivalent / 100 : null;
  const gasTinybars = {};
  for (const f of (fees && fees.ok ? fees.data?.fees : null) || []) gasTinybars[f.transaction_type] = Number(f.gas);
  const rows = [];
  const notes = [];
  let feeUsd = 0;
  let gasHbarTotal = 0;
  let incomplete = false;
  for (const o of ops) {
    const usd = o.fee[0] * o.count;
    feeUsd += usd;
    let gasCell = "";
    if (o.isContract) {
      if (!o.gas) {
        incomplete = true;
        gasCell = " + gas not included";
        notes.push(`${o.type}: no gas limit given, so its gas is NOT in the total. Pass "gas" (estimate with the Mirror Node /api/v1/contracts/call, estimate: true).`);
      } else {
        const price = gasTinybars[o.type === "contract_create" ? "ContractCreate" : "ContractCall"] || gasTinybars.ContractCall;
        if (!price) {
          incomplete = true;
          gasCell = " + gas price unavailable";
          notes.push(`${o.type}: live gas price unavailable (Mirror Node /network/fees ${fees ? describeFailure(fees).split("\n")[0] : "not read"}), so gas is NOT in the total.`);
        } else {
          const g = o.gas * price * o.count / 1e8;
          gasHbarTotal += g;
          gasCell = ` + ${g.toFixed(4)} \u210F gas${usdPerHbar ? ` ($${(g * usdPerHbar).toFixed(4)})` : ""}`;
        }
      }
    }
    rows.push(`| ${o.fee[1]} | ${o.count} | $${usd.toFixed(4)} | ${usdPerHbar ? (usd / usdPerHbar).toFixed(4) : "?"} \u210F${gasCell} |`);
  }
  if (!usdPerHbar) notes.push(`Live exchange rate unavailable (${describeFailure(rate).split("\n")[0]}): HBAR amounts and gas in USD cannot be computed.`);
  const gasUsd = usdPerHbar ? gasHbarTotal * usdPerHbar : null;
  const totalUsd = gasUsd != null ? feeUsd + gasUsd : gasHbarTotal ? null : feeUsd;
  const totalHbar = usdPerHbar ? feeUsd / usdPerHbar + gasHbarTotal : null;
  const label = incomplete ? "**Total (incomplete: excludes gas, see notes)**" : "**Total**";
  return [
    `### Estimated cost on ${net}`,
    usdPerHbar ? `Exchange rate now: 1 \u210F = $${usdPerHbar.toFixed(5)} (Mirror Node ${net} /network/exchangerate)` : "Exchange rate unavailable: showing USD fees only.",
    "",
    "| Operation | Count | USD | HBAR |",
    "| :--- | ---: | ---: | ---: |",
    ...rows,
    `| ${label} | | **${totalUsd != null ? "$" + totalUsd.toFixed(4) : "?"}** | **${totalHbar != null ? totalHbar.toFixed(4) : "?"} \u210F** |`,
    ...notes.length ? ["", ...notes.map((n) => `- ${n}`)] : [],
    "",
    "Assumptions: USD fees are approximate values of the network fee schedule (https://hedera.com/fees), not read live; HBAR uses the live Mirror Node exchange rate; gas uses the live Mirror Node gas price (tinybars per gas) times the gas limit you give, i.e. an upper bound (since HIP-1249 only gas actually used is charged). HCS messages and files also grow with size."
  ].join("\n");
}
class InvalidParams extends Error {
}
const LANG_PROP = { type: "string", enum: ["en", "es"], description: 'Course language (default "en")' };
const TOOLS = [
  {
    name: "search_labs",
    title: "Search the labs",
    description: "Find the Hedera by Example labs that teach something (free text in English or Spanish, SDK class names, HIP/HCS numbers). Returns a ranked list with what each lab needs, its cost and a link; use get_lab for the code.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: 'e.g. "nft royalties", "TopicMessageSubmitTransaction", "HIP-904 airdrop", "x402"' }, module: { type: "string", description: 'Optional module, e.g. "M3"' }, lang: LANG_PROP, limit: { type: "integer", minimum: 1, maximum: 20, description: "Results (default 5)" } }, required: ["query"] },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "get_lab",
    title: "Get a lab",
    description: "Full lab: concept, what to run first, wallets it needs, approximate HBAR cost, official references and the complete runnable code.",
    inputSchema: { type: "object", properties: { slug: { type: "string", description: 'Lab slug from search_labs or list_labs, e.g. "m03-01-immutable-issuance"' }, lang: LANG_PROP, include_code: { type: "boolean", description: "Include the code (default true)" } }, required: ["slug"] },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "list_labs",
    title: "List the course",
    description: "The course map: 16 modules and 131 labs with their slugs, optionally for one module.",
    inputSchema: { type: "object", properties: { module: { type: "string", description: 'Optional module, e.g. "M8"' }, lang: LANG_PROP } },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "query_curriculum",
    title: "Search labs with code",
    description: "Search the labs and return the best matches with their full code (heavier than search_labs + get_lab).",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Search term, concept or SDK class" }, module: { type: "string", description: 'Optional module, e.g. "M3"' }, lang: LANG_PROP, limit: { type: "integer", minimum: 1, maximum: 5, description: "Labs with code (default 3)" } } },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "anti_hallucination_rules",
    title: "Hedera guardrails",
    description: "Verified rules that prevent the usual mistakes on Hedera: tinybar units, Hbar math, fees and gas, key types, EVM addresses, associations, size limits, Mirror Node lag.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "architecture_decision_tree",
    title: "HCS vs HTS vs smart contracts",
    description: "When to use the Consensus Service, the Token Service or smart contracts, with the full guardrails guide.",
    inputSchema: { type: "object", properties: { focus: { type: "string", description: 'Optional section to keep, e.g. "fees", "keys", "NFT"' } } },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "mirror_node_query",
    title: "Read Hedera state",
    description: "Live read from the public Mirror Node (free): accounts, tokens, topics (with decoded messages), transactions, contracts, schedules, balances, exchange rate, gas prices, nodes, blocks. Upstream HTTP errors and timeouts return isError; follow links.next with the next argument.",
    inputSchema: {
      type: "object",
      required: ["endpoint"],
      properties: {
        endpoint: { type: "string", enum: Object.keys(MIRROR_ROUTES) },
        id: { type: "string", description: "Entity ID (0.0.123), EVM address (0x\u2026) or transaction ID; not needed for network/*, balances, blocks" },
        sub: { type: "string", description: "Sub-resource: accounts \u2192 tokens | nfts | allowances/crypto | allowances/tokens | rewards; tokens \u2192 nfts | balances; topics \u2192 messages; contracts \u2192 results | state" },
        network: { type: "string", enum: ["testnet", "mainnet", "previewnet"], description: 'Default "testnet"' },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        next: { type: "string", description: "Pagination: the relative links.next value (/api/v1/\u2026) returned by a previous call for the same endpoint/id/sub/network" },
        order: { type: "string", enum: ["asc", "desc"] }
      }
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "estimate_cost",
    title: "Estimate HBAR cost",
    description: "Price a set of Hedera operations in USD and in HBAR at the live exchange rate (and gas at the live gas price times the gas limit you give; without gas, contract totals are marked incomplete).",
    inputSchema: {
      type: "object",
      required: ["operations"],
      properties: {
        operations: { type: "array", items: { type: "object", required: ["type"], properties: { type: { type: "string", enum: Object.keys(FEES_USD) }, count: { type: "integer", minimum: 1 }, gas: { type: "integer", minimum: 1, maximum: 15e6, description: "Gas limit, for contract_create / contract_call (without it the total excludes gas and is marked incomplete)" } } } },
        network: { type: "string", enum: ["testnet", "mainnet"], description: 'Default "testnet"' }
      }
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "query_knowledge",
    title: "Hedera ecosystem map",
    description: "Curated map of Hedera studios, SDKs, standards and solutions (AI agents, RWA/ATS, stablecoins, DePIN, identity, privacy) with official links.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, category: { type: "string" }, audience: { type: "string", enum: ["developer", "architect", "business", "founder"] } } },
    annotations: { readOnlyHint: true, openWorldHint: false }
  },
  {
    name: "official_resources",
    title: "Official links",
    description: "Official Hedera documentation, repositories and specifications.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }
];

function handleSearchLabs (p = {}) {
  const lang = langOf(p.lang)
  if (!String(p.query || '').trim()) throw new InvalidParams('query is required')
  const hits = searchLabs({ ...p, lang })
  if (!hits.length) return `No lab matches "${p.query}". Try SDK class names (TokenCreateTransaction), standards (HCS-10, HIP-991) or list_labs.`
  return `Labs for "${p.query}" (${lang}):\n\n${hits.map((h) => summaryLine(h, lang)).join('\n\n')}`
}

function handleGetLab (p = {}) {
  const lang = langOf(p.lang)
  const slug = String(p.slug || '').trim()
  const md = slug && labMarkdown(slug, lang, { includeCode: p.include_code !== false })
  if (!md) throw new InvalidParams(`unknown lab "${slug}". Use search_labs or list_labs to find slugs.`)
  return md
}

function handleListLabs (p = {}) {
  const lang = langOf(p.lang)
  const index = readJson('index')
  if (!index) return 'Course content not built: run `npm run compile:course` first.'
  const mod = normalizeModule(p.module)
  return index.modules.filter((m) => !mod || moduleId(m) === mod).map((m) => [
    `## ${moduleId(m)} — ${m[lang]?.title || m.en.title}`,
    ...m.labs.map((l) => `- ${l.n} ${(l[lang] || l.en).title} — \`${l.slug}\``)
  ].join('\n')).join('\n\n') || `No module ${p.module}.`
}

function handleQueryCurriculum (p = {}) {
  const lang = langOf(p.lang)
  const hits = searchLabs({ query: p.query || '', module: p.module, lang, limit: Math.min(Number(p.limit) || 3, 5) })
  if (!hits.length) return `No labs found matching query: "${p.query || ''}" in language "${lang}". Try SDK classes like "PrivateKey", "TopicMessageSubmitTransaction" or "TransferTransaction".`
  return hits.map((h) => labMarkdown(h.lab.slug, lang)).join('\n\n---\n\n')
}

function handleQueryKnowledge (p = {}) {
  const catalog = readJson('catalog')
  if (!catalog?.resources) return 'Knowledge catalog not found.'
  let results = catalog.resources
  if (p.category) results = results.filter((r) => norm(r.category).includes(norm(p.category)))
  if (p.audience) results = results.filter((r) => (r.audience || []).includes(String(p.audience).toLowerCase()))
  const words = tokens(p.query)
  if (words.length) {
    results = results.map((r) => {
      const hay = norm([r.name, r.summary, r.technicalStack, ...(r.searchTriggers || [])].join(' '))
      return { r, s: words.filter((w) => hay.includes(w)).length }
    }).filter((x) => x.s).sort((a, b) => b.s - a.s).map((x) => x.r)
  }
  if (!results.length) return `Nothing matches "${p.query || p.category}". Categories: ${(catalog.categories || []).join(', ')}.`
  return results.slice(0, 5).map((r) => `### ${r.name}
- **Category:** ${r.category} (${r.layer})
- **Summary:** ${r.summary}
- **Business value:** ${r.businessValue}
- **Tech stack:** ${r.technicalStack}
- **Links:** ${Object.entries(r.urls || {}).map(([k, v]) => `[${k}](${v})`).join(' | ')}
- **Watch out:** ${r.antiHallucinationNotes}`).join('\n\n')
}

function handleArchitecture (p = {}) {
  const doc = readText('architecture')
  if (!doc) return GUARDRAILS
  if (!p.focus) return doc
  const parts = doc.split(/\n(?=#{2,3} )/)
  const keep = parts.filter((s) => norm(s).includes(norm(p.focus)))
  return keep.length ? keep.join('\n') : doc
}

function handleOfficialResources (p = {}) {
  const doc = readText('resources')
  if (!doc) return 'Official resources file not found.'
  const words = tokens(p.query)
  if (!words.length) return doc
  const lines = doc.split('\n').filter((l) => l.startsWith('| Resource') || l.startsWith('| :---') || words.some((w) => norm(l).includes(w)))
  return lines.join('\n')
}

async function callTool (name, args = {}) {
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

// ============================================================================
// RESOURCES
// ============================================================================

const DOC_RESOURCES = [
  { uri: 'hbe://guide/guardrails', name: 'guardrails', title: 'Hedera guardrails for coding agents', mimeType: 'text/markdown', read: () => GUARDRAILS },
  { uri: 'hbe://guide/architecture', name: 'architecture', title: 'Architecture decision tree & guardrails', mimeType: 'text/markdown', read: () => readText('architecture') },
  { uri: 'hbe://guide/official-resources', name: 'official-resources', title: 'Official Hedera resources', mimeType: 'text/markdown', read: () => readText('resources') },
  { uri: 'hbe://guide/hackathon', name: 'hackathon', title: 'Hackathon rules and guidelines', mimeType: 'text/markdown', read: () => readText('hackathon') },
  { uri: 'hbe://labs/en', name: 'labs-en', title: 'Course map (English)', mimeType: 'text/markdown', read: () => handleListLabs({ lang: 'en' }) },
  { uri: 'hbe://labs/es', name: 'labs-es', title: 'Mapa del curso (español)', mimeType: 'text/markdown', read: () => handleListLabs({ lang: 'es' }) }
]

function listResources () {
  const labs = labCatalog().flatMap(({ module: m, lab }) => ['en', 'es'].map((lang) => ({
    uri: `hbe://lab/${lang}/${lab.slug}`,
    name: `${lab.slug}-${lang}`,
    title: `${moduleId(m)} Lab ${lab.n} — ${(lab[lang] || lab.en).title} (${lang})`,
    mimeType: 'text/markdown'
  })))
  return [...DOC_RESOURCES.map(({ read, ...r }) => r), ...labs]
}

function readResource (uri) {
  const doc = DOC_RESOURCES.find((r) => r.uri === uri)
  if (doc) return doc.read()
  const m = String(uri).match(/^hbe:\/\/lab\/(en|es)\/([a-z0-9-]+)$/)
  return m ? labMarkdown(m[2], m[1]) : null
}

// ============================================================================
// PROMPTS
// ============================================================================

const PROMPTS = [
  { name: 'build_on_hedera', title: 'Build a feature on Hedera', description: 'Plan and write Hedera code for a goal, grounded in the course labs and the guardrails.', arguments: [{ name: 'goal', description: 'What you want to build', required: true }, { name: 'lang', description: 'en or es', required: false }] },
  { name: 'explain_lab', title: 'Explain a lab', description: 'Walk through one lab step by step, with what it needs and what it costs.', arguments: [{ name: 'slug', description: 'Lab slug, e.g. m04-04-atomic-swaps', required: true }, { name: 'lang', description: 'en or es', required: false }] },
  { name: 'review_hedera_code', title: 'Review Hedera code', description: 'Review code against the Hedera guardrails (units, fees, gas, keys, limits, Mirror Node use).', arguments: [{ name: 'code', description: 'The code to review', required: true }] }
]

function getPrompt (name, args = {}) {
  const lang = langOf(args.lang)
  const user = (text) => ({ role: 'user', content: { type: 'text', text } })
  if (name === 'build_on_hedera') {
    if (!args.goal) throw new InvalidParams('goal is required')
    const labs = searchLabs({ query: args.goal, lang, limit: 4 })
    return {
      description: `Build on Hedera: ${args.goal}`,
      messages: [user(`${GUARDRAILS}\n\n# Labs from Hedera by Example that cover this\n${labs.map((h) => summaryLine(h, lang)).join('\n\n') || '(none matched; use search_labs)'}\n\n# Task\nGoal: ${args.goal}\n\nPick the right services (HCS, HTS, smart contracts), say which lab patterns you reuse (get_lab gives their code), estimate the HBAR cost with estimate_cost, then write the code with @hiero-ledger/sdk. Follow every guardrail above.`)]
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

// ============================================================================
// JSON-RPC
// ============================================================================

const INSTRUCTIONS = `Hedera by Example: 131 runnable Hedera labs (English/Spanish) built on @hiero-ledger/sdk, plus verified guardrails.
Start with search_labs (or list_labs), read a lab with get_lab, check anti_hallucination_rules before writing Hedera code, price operations with estimate_cost, and read live state with mirror_node_query. Every lab also runs in the browser at ${WEB}.`

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result })

async function dispatchOne (msg) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return rpcError(msg?.id, -32600, 'Invalid Request')
  const { id, method, params = {} } = msg
  const isNotification = id === undefined || id === null
  if (method === undefined) return null // a response from the client: nothing to do
  if (isNotification) return null // notifications (initialized, cancelled, ...) never get a reply
  try {
    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion
        const protocolVersion = SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0]
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
        try {
          const text = await callTool(name, params.arguments || {})
          return rpcResult(id, { content: [{ type: 'text', text: String(text) }] })
        } catch (err) {
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
  } catch (err) {
    return rpcError(id, err instanceof InvalidParams ? -32602 : -32603, err.message)
  }
}

/** One message or a batch; returns what to send back (null when nothing). */
async function dispatchJsonRpc (payload) {
  if (Array.isArray(payload)) {
    if (!payload.length) return rpcError(null, -32600, 'Invalid Request: empty batch')
    const out = (await Promise.all(payload.map(dispatchOne))).filter(Boolean)
    return out.length ? out : null
  }
  return dispatchOne(payload)
}

// ============================================================================
// TRANSPORTS
// ============================================================================

function startStdio () {
  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  rl.on('line', async (line) => {
    if (!line.trim()) return
    let payload
    try { payload = JSON.parse(line) } catch (err) {
      process.stdout.write(JSON.stringify(rpcError(null, -32700, `Parse error: ${err.message}`)) + '\n')
      return
    }
    const response = await dispatchJsonRpc(payload)
    if (response) process.stdout.write(JSON.stringify(response) + '\n')
  })
  process.stderr.write(`[hedera-by-example-mcp ${VERSION}] listening on stdio\n`)
}

function startHttp ({ port, host, allowOrigins }) {
  const sessions = new Map() // legacy SSE sessions: id -> response stream
  const MAX_BODY = 1_000_000
  const originAllowed = (origin) => !origin || allowOrigins.includes('*') || allowOrigins.includes(origin) ||
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Body too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
  const json = (res, status, body, extra = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...extra }); res.end(body == null ? '' : JSON.stringify(body)) }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin
    if (!originAllowed(origin)) return json(res, 403, { error: 'Origin not allowed' })
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version')
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id')
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    const url = new URL(req.url, 'http://localhost')

    if (url.pathname === '/' || url.pathname === '/health') {
      return json(res, 200, { status: 'online', server: 'hedera-by-example-mcp', version: VERSION, protocols: SUPPORTED_PROTOCOLS, tools: TOOLS.length, endpoints: { streamableHttp: '/mcp', legacySse: '/sse', tools: '/tools' } })
    }
    if (url.pathname === '/tools') return json(res, 200, { tools: TOOLS })

    // Streamable HTTP (2025-03-26+): POST JSON-RPC, JSON response.
    if (url.pathname === '/mcp' || url.pathname === '/api/mcp') {
      if (req.method === 'GET') return json(res, 405, { error: 'This server answers POST requests with JSON; no server-initiated stream.' }, { Allow: 'POST' })
      if (req.method === 'DELETE') { res.writeHead(204); return res.end() }
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' }, { Allow: 'POST' })
      let payload
      try { payload = JSON.parse(await readBody(req)) } catch (err) { return json(res, 400, rpcError(null, -32700, `Parse error: ${err.message}`)) }
      const response = await dispatchJsonRpc(payload)
      if (!response) { res.writeHead(202); return res.end() }
      return json(res, 200, response)
    }

    // Legacy HTTP+SSE (2024-11-05): GET /sse opens the stream, POST /messages?sessionId=… sends.
    if (url.pathname === '/sse' && req.method === 'GET') {
      const sessionId = crypto.randomUUID()
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`)
      sessions.set(sessionId, res)
      const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25000)
      req.on('close', () => { clearInterval(keepAlive); sessions.delete(sessionId) })
      return
    }
    if (url.pathname === '/messages' && req.method === 'POST') {
      const stream = sessions.get(url.searchParams.get('sessionId'))
      if (!stream) return json(res, 404, { error: 'Unknown or closed session' })
      let payload
      try { payload = JSON.parse(await readBody(req)) } catch (err) { return json(res, 400, rpcError(null, -32700, `Parse error: ${err.message}`)) }
      res.writeHead(202); res.end()
      const response = await dispatchJsonRpc(payload)
      if (response) stream.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`)
      return
    }
    json(res, 404, { error: 'Not found', endpoints: ['/mcp', '/sse', '/messages', '/tools', '/health'] })
  })
  server.listen(port, host, () => {
    process.stderr.write(`[hedera-by-example-mcp ${VERSION}] http://${host}:${port}\n  Streamable HTTP: POST http://${host}:${port}/mcp\n  Legacy SSE:      GET  http://${host}:${port}/sse\n`)
  })
  return server
}

// ============================================================================
// CLI
// ============================================================================

const argv = process.argv.slice(2)
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) }
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(`hedera-by-example-mcp ${VERSION}
Usage:
  node mcp/index.js                       stdio transport (Claude Code, Claude Desktop, Cursor, VS Code)
  node mcp/index.js --http [port]         HTTP transport (default port 3001)
      --host <addr>                       bind address (default 127.0.0.1)
      --allow-origin <origin,...|*>       browser origins allowed besides localhost
`)
} else if (argv.includes('--http') || argv.includes('--port') || argv.includes('-p')) {
  const p = flag('--http') ?? flag('--port') ?? flag('-p')
  startHttp({
    port: Number.isFinite(Number(p)) && p !== true ? Number(p) : 3001,
    host: typeof flag('--host') === 'string' ? flag('--host') : '127.0.0.1',
    allowOrigins: String(flag('--allow-origin') || '').split(',').filter(Boolean)
  })
} else {
  startStdio()
}

