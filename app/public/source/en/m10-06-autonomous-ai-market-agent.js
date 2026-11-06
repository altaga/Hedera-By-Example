/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 06: An Agent That Shops for Data
 * [CONCEPT] Use free 402 quotes to compare providers, then pay only the best one
 * ============================================================================
 * [ KEY CONCEPT ]
 * A 402 costs nothing, so it doubles as a price quote: an agent can compare
 * providers for free and pay only the one it picks.
 *
 * Here three data providers sell the same kind of signal at different prices
 * and quality. The agent:
 *   1. reads each provider's free catalogue entry (name, accuracy),
 *   2. asks for the paid resource without paying, and reads the price from the 402,
 *   3. scores every offer (accuracy per HBAR) and drops those over its cap,
 *   4. pays the winner with fetchWithPayment, and only the winner.
 *
 * No API keys, accounts or contracts with any provider: the 402 is the whole
 * integration.
 *
 * [ LEARNABLE MOMENT ]
 * Discovery and payment are separate steps. Quoting every provider is free;
 * money moves once, to the provider the agent chose, and the receipt (the
 * Hedera transaction id) proves which one it paid.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://docs.hedera.com/solutions/ai/x402/pay-with-x402
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 05: Spending Guardrails for Agents
 * - Next:     M10 Lab 07: Paying for an AI Stream in Batches
 *
 * [ SEQUENCE ]
 * Agent -> Provider A: GET /meta and GET /signal (402: price)
 * Agent -> Provider B: GET /meta and GET /signal (402: price)
 * Agent -> Provider C: GET /meta and GET /signal (402: price)
 * Note Agent: scores accuracy per HBAR, picks one
 * Agent -> Provider B: GET /signal with PAYMENT-SIGNATURE
 * Provider B -> Agent: 200 + data + PAYMENT-RESPONSE
 *
 * [ SIMULATED ]
 * The three providers run inside the lab and return canned signals, and they all pay into ACCOUNT_2. The quotes and the payment are real x402 on testnet.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the facilitator.
 * - Practice wallets: ACCOUNT_1 is the agent, ACCOUNT_2 receives for the providers.
 * - Cost: up to 0.015 ℏ from ACCOUNT_1 to ACCOUNT_2; about 0.003 ℏ in fees for you.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/06_autonomous_ai_market_agent.js
 * ============================================================================
 */

import http from 'node:http'
import { x402ResourceServer } from '@x402/core/server'
import { wrapFetchWithPayment } from '@x402/fetch'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HBAR_ASSET_ID } from '@x402/hedera'
import {
  getClient,
  getHashscanUrl,
  ensureFunded,
  updateState,
  show,
  X402_NETWORK,
  createBuyer,
  createLocalFacilitator,
  paywall,
  readPaymentRequired,
  readPaymentResponse,
  formatHbar
} from '../M99_Utilities/index.js'

// ─── Config ───────────────────────────────────────────────────────────────────
const PROVIDERS = [
  { port: 4061, name: 'DeepAlpha Quant', accuracy: 0.94, price: '1500000' }, // 0.015 ℏ
  { port: 4062, name: 'OpenSentiment', accuracy: 0.91, price: '600000' }, // 0.006 ℏ
  { port: 4063, name: 'Apex Hedge Feed', accuracy: 0.98, price: '9000000' } // 0.09 ℏ
]
const MAX_PER_PAYMENT = 2_000_000n // the agent never pays more than 0.02 ℏ for one call

// ─── Main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- SESSION START: An Agent That Shops for Data ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  if (!agentId || !agentKey || !merchantId) throw new Error('Missing ACCOUNT_1 (agent) or ACCOUNT_2 (merchant). Create practice wallets or set them in .env.')

  const servers = []
  try {
    await ensureFunded(client, agentId, 1)
    const { client: facilitator } = createLocalFacilitator(operatorId, operatorKey)

    // 1. Three providers: a free catalogue entry (/meta) and a paid signal (/signal).
    for (const provider of PROVIDERS) {
      const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactHederaScheme())
      const routes = {
        'GET /signal': {
          accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: { amount: provider.price, asset: HBAR_ASSET_ID } }],
          description: `${provider.name} macro signal`
        }
      }
      const handlers = {
        'GET /meta': () => ({ name: provider.name, accuracy: provider.accuracy }),
        'GET /signal': () => ({ source: provider.name, macro: 'INFLATION_COOLING', bias: 'LONG_RISK', confidence: provider.accuracy })
      }
      const server = http.createServer(paywall(resourceServer, routes, handlers))
      await new Promise((resolve) => server.listen(provider.port, '127.0.0.1', resolve))
      servers.push(server)
    }

    // 2. Discovery: read each catalogue entry and the price in its 402. Nothing is paid here.
    console.log('[PROCESS] Asking every provider for a quote (free)...')
    const quotes = []
    for (const { port } of PROVIDERS) {
      const meta = await (await fetch(`http://127.0.0.1:${port}/meta`)).json()
      const offer = readPaymentRequired(await fetch(`http://127.0.0.1:${port}/signal`)).accepts[0]
      const price = BigInt(offer.amount)
      quotes.push({
        provider: meta.name,
        port,
        accuracy: meta.accuracy,
        price: formatHbar(price),
        withinCap: price <= MAX_PER_PAYMENT,
        // Accuracy points per HBAR: how much quality each HBAR buys.
        score: Number((meta.accuracy / (Number(price) / 1e8)).toFixed(1))
      })
    }
    show.table(quotes)

    // 3. Decide: best score among the offers the agent is allowed to pay.
    const eligible = quotes.filter((q) => q.withinCap).sort((a, b) => b.score - a.score)
    if (!eligible.length) throw new Error('No provider is within the agent\'s per-payment cap')
    const winner = eligible[0]
    console.log(`[SUCCESS] Choosing ${winner.provider}: ${winner.price}, accuracy ${winner.accuracy}`)

    // 4. Pay only the winner.
    const fetchWithPayment = wrapFetchWithPayment(fetch, createBuyer(agentId, agentKey, { maxTinybars: MAX_PER_PAYMENT }))
    const res = await fetchWithPayment(`http://127.0.0.1:${winner.port}/signal`)
    const receipt = readPaymentResponse(res)
    console.log(`[LOG] HTTP ${res.status}, signal: ${JSON.stringify(await res.json())}`)
    if (res.status !== 200 || !receipt?.success) throw new Error(`Payment was not settled: ${receipt?.errorReason || res.status}`)
    console.log(`[LOG] Paid ${winner.provider}: ${getHashscanUrl(receipt.transaction)}`)
    updateState('X402_MARKET_AGENT_TX_ID', receipt.transaction)

    console.log('\n KEY CONCEPT:')
    console.log('Three quotes cost nothing; one payment went to the provider with the best')
    console.log('accuracy per HBAR within the cap. The agent integrated with all three')
    console.log('providers using nothing but HTTP 402.')
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    for (const server of servers) server.close()
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
