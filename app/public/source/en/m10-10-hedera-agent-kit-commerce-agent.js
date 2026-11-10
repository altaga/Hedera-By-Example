/**
 * ============================================================================
 * Lab 10: Commerce Agent with the Hedera Agent Kit
 * [CONCEPT] An AI Agent Pays On-Chain and the Seller Unlocks the Service
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Hedera Agent Kit turns Hedera operations into tools an AI agent can call.
 * HederaAIToolkit hands them to the Vercel AI SDK, whose agent loop (generateText)
 * lets the model call a tool, read its result and decide the next step. This lab
 * builds a pay-to-unlock flow with it: the seller answers 402 with a price and an
 * order memo; the agent checks its balance (get_hbar_balance_query_tool), pays with
 * transfer_hbar_tool and retries; the seller finds the payment on the Mirror Node
 * (payer, payee, amount, paid after the order, not used before) and returns the content.
 * *
 * [ LEARNABLE MOMENT ]
 * The seller never trusts what the agent says it paid: it reads the transaction on the Mirror Node and checks every field itself, and it accepts each payment once. The agent, in turn, checks the price against its budget before it signs anything.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://github.com/hashgraph/hedera-agent-kit-js
 * - https://docs.hedera.com/hedera/open-source-solutions/ai-studio-on-hedera
 * - https://ai-sdk.dev/docs/ai-sdk-core/testing
 * - https://docs.hedera.com/hedera/sdks-and-apis/rest-api/transactions
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 09: Metered Payments with the x402 upto Scheme
 * - Next:     M11 Lab 01: Permissioned RWA Transfers — Identity Registry + HTS KYC (ERC-3643 Concepts)
 *
 * [ SEQUENCE ]
 * Agent -> Seller: GET /api/v1/reports/network-snapshot
 * Seller -> Agent: 402 (orderId, payTo, price, memo)
 * Agent -> Hedera: get_hbar_balance_query_tool (budget check)
 * Agent -> Hedera: transfer_hbar_tool (price to payTo, memo = order)
 * Agent -> Seller: Retry with X-Payment-Transaction
 * Seller -> Hedera: Reads the transaction on the Mirror Node
 * Seller -> Agent: 200 OK + report
 *
 * [ SIMULATED ]
 * The language model is the AI SDK's MockLanguageModelV3 (its official test model, same LanguageModelV3 interface as a real provider). Its policy is scripted, but it reads the real tool results to choose each call. The Agent Kit tools, the HBAR payment, the HTTP 402 exchange (to a server that runs in the page in the browser) and the Mirror Node checks are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account only tops up the practice wallets if they run low.
 * - Practice wallets: ACCOUNT_1 is the agent's wallet (buyer), ACCOUNT_2 the seller.
 * - Cost: 0.01 ℏ from ACCOUNT_1 to ACCOUNT_2 plus about 0.001 ℏ in fees.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/10_hedera_agent_kit_commerce_agent.js
 * ============================================================================
 */

import http from 'node:http'
import crypto from 'node:crypto'
import { Client, PrivateKey } from '@hashgraph/sdk'
import { HederaAIToolkit, HederaBuilder, AgentMode, coreAccountPlugin, coreAccountQueryPlugin } from 'hedera-agent-kit'
import { generateText, stepCountIs, tool, jsonSchema } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { getClient, ensureFunded, waitForMirror, getMirrorNodeBaseUrl, getHashscanUrl, updateState, show } from '../M99_Utilities/index.js'

// Agent Kit tools return their result as a JSON string; the HTTP tool returns an object.
const asObject = (value) => {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch (_) { return { humanMessage: value } }
}

// Agent Kit 3.8.2 builds transfer_hbar_tool's transaction with new TransferTransaction(params), and that
// constructor ignores transactionMemo, so the memo never reaches the network. Until the kit fixes it, wrap
// the builder the tool calls and set the memo on the transaction it returns (scheduled transfers untouched).
if (!HederaBuilder.transferHbar.memoFix) {
  const buildTransferHbar = HederaBuilder.transferHbar
  HederaBuilder.transferHbar = (params) => {
    const tx = buildTransferHbar(params)
    if (params.transactionMemo && !params.schedulingParams?.isScheduled) tx.setTransactionMemo(params.transactionMemo)
    return tx
  }
  HederaBuilder.transferHbar.memoFix = true
}

const PORT = 4320
const PRICE_HBAR = 0.01
const BUDGET_HBAR = 0.05
const RESOURCE = `http://127.0.0.1:${PORT}/api/v1/reports/network-snapshot`

// The Agent Kit is built on @hashgraph/sdk, so the agent's wallet gets a client from that SDK.
const agentClientFor = (accountId, keyText) => {
  const key = /^30[0-9a-fA-F]{60,}$/.test(keyText) ? PrivateKey.fromStringDer(keyText) : PrivateKey.fromString(keyText)
  return Client.forTestnet().setOperator(accountId, key)
}

/**
 * The seller: answers 402 with an order, and unlocks the report only for a payment it finds
 * on the Mirror Node from the buyer, to the seller, for the price, made after the order and unused.
 */
const startSeller = ({ sellerId, buyerId }) => {
  const orders = new Map() // orderId -> { memo, createdAt, used }
  const spentPayments = new Set() // each payment transaction unlocks one order, once
  const priceTinybars = Math.round(PRICE_HBAR * 1e8)

  const checkPayment = async (transactionId, order) => {
    // Mirror Node ids are 0.0.x-seconds-nanos; SDK ids are 0.0.x@seconds.nanos.
    const [payer, validStart] = transactionId.split('@')
    const mirrorId = `${payer}-${validStart.replace('.', '-')}`
    const tx = await waitForMirror(async () => {
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions/${mirrorId}`)
      return res.ok ? (await res.json()).transactions?.[0] : null
    })
    if (!tx) return { problem: 'payment not found on the Mirror Node' }
    if (tx.result !== 'SUCCESS') return { problem: `payment result ${tx.result}` }
    if (spentPayments.has(tx.transaction_id)) return { problem: 'payment already used' }
    if (payer !== buyerId) return { problem: 'paid from another account' }
    // Paid after the order was issued, so an older transfer cannot be presented for it.
    if (Number(tx.consensus_timestamp) < order.createdAt) return { problem: 'payment is older than the order' }
    const received = tx.transfers.filter((t) => t.account === sellerId).reduce((sum, t) => sum + t.amount, 0)
    if (received < priceTinybars) return { problem: `paid ${received} tinybars, price is ${priceTinybars}` }
    spentPayments.add(tx.transaction_id)
    return { memoMatches: Buffer.from(tx.memo_base64 || '', 'base64').toString() === order.memo }
  }

  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'GET' || !req.url.startsWith('/api/v1/reports/network-snapshot')) return send(404, { error: 'not found' })

    const orderId = req.headers['x-order-id']
    const paymentTx = req.headers['x-payment-transaction']
    if (!orderId || !paymentTx) {
      const id = crypto.randomUUID()
      const order = { memo: `hbe-order:${id}`, createdAt: Date.now() / 1000, used: false }
      orders.set(id, order)
      return send(402, { error: 'payment required', orderId: id, payTo: sellerId, priceHbar: PRICE_HBAR, memo: order.memo })
    }

    const order = orders.get(orderId)
    if (!order) return send(402, { error: 'unknown order' })
    if (order.used) return send(402, { error: 'order already redeemed' })
    const check = await checkPayment(paymentTx, order)
    if (check.problem) return send(402, { error: check.problem })
    order.used = true

    // The product: a live snapshot of the network, read from the Mirror Node.
    const [supply, rate] = await Promise.all([
      fetch(`${getMirrorNodeBaseUrl()}/api/v1/network/supply`).then((r) => r.json()),
      fetch(`${getMirrorNodeBaseUrl()}/api/v1/network/exchangerate`).then((r) => r.json())
    ])
    const usdPerHbar = rate.current_rate.cent_equivalent / rate.current_rate.hbar_equivalent / 100
    send(200, {
      orderId,
      memoMatches: check.memoMatches,
      report: {
        releasedSupplyHbar: Math.round(Number(supply.released_supply) / 1e8),
        usdPerHbar: Number(usdPerHbar.toFixed(5)),
        rateExpires: new Date(rate.current_rate.expiration_time * 1000).toISOString()
      }
    })
  })
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)))
}

/**
 * The agent's "model": AI SDK's MockLanguageModelV3 with a scripted policy. Like a real model,
 * it only sees the conversation (the prompt and the tool results) and answers with tool calls.
 */
const createScriptedModel = (agentId) => {
  const finish = (text) => ({ content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } }, warnings: [] })
  const call = (toolName, input) => ({ content: [{ type: 'tool-call', toolCallId: crypto.randomUUID(), toolName, input: JSON.stringify(input) }], finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } }, warnings: [] })

  // Tool results so far, in order, as the AI SDK passes them to the model.
  const results = (prompt) => prompt.filter((m) => m.role === 'tool').flatMap((m) => m.content).filter((p) => p.type === 'tool-result')
    .map((p) => ({ name: p.toolName, value: asObject(p.output.value) }))

  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      const seen = results(prompt)
      const last = seen[seen.length - 1]
      if (!last) return call('fetch_resource', { url: RESOURCE })

      if (last.name === 'fetch_resource' && last.value.status === 402 && !seen.some((r) => r.name === 'transfer_hbar_tool')) {
        return call('get_hbar_balance_query_tool', { accountId: agentId })
      }
      if (last.name === 'get_hbar_balance_query_tool') {
        const offer = seen.find((r) => r.name === 'fetch_resource').value.body
        if (offer.priceHbar > BUDGET_HBAR) return finish(`The price (${offer.priceHbar} ℏ) is above my budget (${BUDGET_HBAR} ℏ). Not buying.`)
        return call('transfer_hbar_tool', { transfers: [{ accountId: offer.payTo, amount: offer.priceHbar }], transactionMemo: offer.memo })
      }
      if (last.name === 'transfer_hbar_tool') {
        if (last.value.raw?.status !== 'SUCCESS') return finish(`Payment failed: ${last.value.humanMessage}`)
        const offer = seen.find((r) => r.name === 'fetch_resource').value.body
        return call('fetch_resource', { url: RESOURCE, orderId: offer.orderId, paymentTransaction: last.value.raw.transactionId })
      }
      if (last.name === 'fetch_resource' && last.value.status === 200) return finish('Report unlocked.')
      return finish(`Stopped: ${JSON.stringify(last.value).slice(0, 200)}`)
    }
  })
}

const main = async () => {
  console.log('--- SESSION START: Commerce Agent with the Hedera Agent Kit ---\n')
  const { client } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const sellerId = process.env.ACCOUNT_2_ID
  if (!agentId || !agentKey || !sellerId) {
    console.error('[FAILED] Missing credentials in .env (ACCOUNT_1 agent wallet, ACCOUNT_2 seller).')
    process.exitCode = 1
    return
  }

  let seller = null
  let agentClient = null
  try {
    await ensureFunded(client, agentId, 1)

    // 1. The seller's HTTP endpoint (in the browser it runs in the page: a tab cannot open a port).
    seller = await startSeller({ sellerId, buyerId: agentId })
    console.log(`[INFO] Seller listening on ${RESOURCE} (payee ${sellerId}, price ${PRICE_HBAR} ℏ)`)

    // 2. The Agent Kit tools for the agent's wallet, plus one plain HTTP tool.
    agentClient = agentClientFor(agentId, agentKey)
    const toolkit = new HederaAIToolkit({
      client: agentClient,
      configuration: { plugins: [coreAccountPlugin, coreAccountQueryPlugin], context: { mode: AgentMode.AUTONOMOUS, accountId: agentId } }
    })
    const kitTools = toolkit.getTools()
    console.log(`[INFO] Agent Kit tools loaded: ${Object.keys(kitTools).length} (using get_hbar_balance_query_tool and transfer_hbar_tool)`)

    const fetchResource = tool({
      description: 'GET a URL. Pass orderId and paymentTransaction to redeem a paid order.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: { url: { type: 'string' }, orderId: { type: 'string' }, paymentTransaction: { type: 'string' } },
        required: ['url']
      }),
      execute: async ({ url, orderId, paymentTransaction }) => {
        const headers = orderId ? { 'x-order-id': orderId, 'x-payment-transaction': paymentTransaction } : {}
        const res = await fetch(url, { headers })
        return { status: res.status, body: await res.json() }
      }
    })

    // 3. The agent loop: the model calls a tool, the AI SDK runs it and feeds the result back.
    console.log('\n[PROCESS] Agent task: "Buy today\'s network snapshot report."')
    const run = await generateText({
      model: createScriptedModel(agentId),
      tools: { ...kitTools, fetch_resource: fetchResource },
      prompt: `Buy today's network snapshot report from ${RESOURCE}. Budget: ${BUDGET_HBAR} HBAR. Your account is ${agentId}.`,
      stopWhen: stepCountIs(8)
    })

    const steps = run.steps.flatMap((s) => s.toolResults.map((r) => ({ tool: r.toolName, result: asObject(r.output) })))
    show.table(steps.map((s, i) => ({
      step: i + 1,
      tool: s.tool,
      result: s.tool === 'fetch_resource' ? `HTTP ${s.result.status}` : s.tool === 'transfer_hbar_tool' ? `${s.result.raw?.status} ${s.result.raw?.transactionId || ''}` : String(s.result.humanMessage || '').split('\n')[0].slice(0, 80)
    })))

    const payment = steps.find((s) => s.tool === 'transfer_hbar_tool')?.result.raw
    const unlocked = steps.filter((s) => s.tool === 'fetch_resource').pop()?.result
    if (!payment || unlocked?.status !== 200) throw new Error(`the agent did not unlock the report (${run.text})`)

    console.log(`[SUCCESS] Paid ${PRICE_HBAR} ℏ: ${payment.transactionId}`)
    console.log(`[EXPLORER] ${getHashscanUrl(payment.transactionId)}`)
    console.log('[SUCCESS] Seller verified the payment on the Mirror Node and unlocked the report:')
    show.json(unlocked.body.report)
    // Agent Kit 3.8.2's transfer_hbar_tool builds new TransferTransaction(params), whose constructor
    // ignores transactionMemo, so the memo was lost; the patch above restores it. The seller does not depend on it either way.
    console.log(`[INFO] Order memo on the payment: ${unlocked.body.memoMatches ? 'present' : 'missing (the Agent Kit did not set it)'}`)
    console.log(`[LOG] Agent: ${run.text}`)

    // 4. A payment unlocks one order once: presenting it again for a new order is refused.
    const fresh = await (await fetch(RESOURCE)).json()
    const replay = await fetch(RESOURCE, { headers: { 'x-order-id': fresh.orderId, 'x-payment-transaction': payment.transactionId } })
    console.log(`[SUCCESS] Same payment for a new order: HTTP ${replay.status} (${(await replay.json()).error})`)
    updateState('M10_AGENT_KIT_LAST_PAYMENT', payment.transactionId)

    console.log('\n KEY CONCEPT:')
    console.log('HederaAIToolkit gives the AI SDK agent real Hedera tools; the model only decides which to call.')
    console.log('\n LEARNABLE MOMENT:')
    console.log('The seller unlocks on what the Mirror Node shows, never on what the agent claims.')
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    if (seller) seller.close()
    if (agentClient) agentClient.close()
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
