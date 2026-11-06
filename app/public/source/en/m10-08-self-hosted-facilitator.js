/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 08: Run Your Own Facilitator
 * [CONCEPT] The facilitator is an HTTP service; the merchant can host it and pay the fees
 * ============================================================================
 * [ KEY CONCEPT ]
 * So far the facilitator lived inside the server process. In production it is
 * a separate HTTP service, and the merchant can host it itself.
 *
 * It has three endpoints, defined by the x402 spec:
 *   - GET  /supported  which schemes and networks it handles, and its feePayer
 *   - POST /verify     { paymentPayload, paymentRequirements } → isValid, payer
 *   - POST /settle     same body → success, transaction id
 *
 * A resource server talks to any facilitator through HTTPFacilitatorClient, so
 * switching between a public one (https://x402.org/facilitator) and your own is
 * a change of URL.
 *
 * Here the merchant runs its own facilitator with its own account as fee payer:
 * two parties (buyer and merchant), no third-party dependency. The merchant
 * receives the price and pays the network fee out of it.
 *
 * [ LEARNABLE MOMENT ]
 * Hosting the facilitator means holding a funded key that co-signs payments, so
 * it is a real service to secure and monitor. Its checks (fee payer, amounts,
 * payee, signature, balance) are what stop it from paying fees for invalid or
 * malicious transfers. Set X402_FACILITATOR_URL to use a hosted one instead.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/facilitators
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 * - https://www.npmjs.com/package/@x402/hedera
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 07: Paying for an AI Stream in Batches
 * - Next:     M11 Lab 01: Permissioned RWA Transfers (ERC-3643 Concepts)
 *
 * [ SEQUENCE ]
 * Server -> Facilitator: GET /supported (feePayer = the merchant)
 * Agent -> Server: GET /api/report
 * Server -> Agent: 402 (payTo and feePayer are both the merchant)
 * Agent -> Server: retry with PAYMENT-SIGNATURE
 * Server -> Facilitator: POST /verify, then POST /settle
 * Facilitator -> Hedera: submits, paying the fee from the merchant's account
 * Server -> Agent: 200 + PAYMENT-RESPONSE
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account only tops up the practice wallets if they run low.
 * - Practice wallets: ACCOUNT_1 is the agent, ACCOUNT_2 the merchant and its facilitator.
 * - Cost: 0.01 ℏ from ACCOUNT_1 to ACCOUNT_2; ACCOUNT_2 pays about 0.003 ℏ in fees.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/08_self_hosted_facilitator.js
 * ============================================================================
 */

import http from 'node:http'
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { wrapFetchWithPayment } from '@x402/fetch'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HBAR_ASSET_ID } from '@x402/hedera'
import {
  getClient,
  getHashscanUrl,
  getMirrorNodeBaseUrl,
  ensureFunded,
  waitForMirror,
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
const API_PORT = 4028
const FACILITATOR_PORT = 4029
const PRICE_TINYBARS = '1000000' // 0.01 ℏ

/** Reads a JSON request body from node:http. */
const readJson = (req) => new Promise((resolve, reject) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => { try { resolve(JSON.parse(raw || '{}')) } catch (error) { reject(error) } })
})

// ─── Main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- SESSION START: Run Your Own Facilitator ---\n')
  const { client } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  const merchantKey = process.env.ACCOUNT_2_PRIVATE_KEY
  if (!agentId || !agentKey || !merchantId || !merchantKey) throw new Error('Missing ACCOUNT_1 (agent) or ACCOUNT_2 (merchant). Create practice wallets or set them in .env.')

  const servers = []
  try {
    // The agent needs the price; the merchant needs HBAR for the fees it now pays.
    await ensureFunded(client, agentId, 1)
    await ensureFunded(client, merchantId, 1)

    // 1. The facilitator service, run by the merchant with its own account as fee payer.
    let facilitatorUrl = process.env.X402_FACILITATOR_URL
    if (!facilitatorUrl) {
      const { facilitator } = createLocalFacilitator(merchantId, merchantKey)
      const service = http.createServer(async (req, res) => {
        const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
        try {
          if (req.method === 'GET' && req.url === '/supported') return reply(200, facilitator.getSupported())
          if (req.method === 'POST' && (req.url === '/verify' || req.url === '/settle')) {
            const { paymentPayload, paymentRequirements } = await readJson(req)
            console.log(`  [FACILITATOR] POST ${req.url}`)
            const result = req.url === '/verify'
              ? await facilitator.verify(paymentPayload, paymentRequirements)
              : await facilitator.settle(paymentPayload, paymentRequirements)
            return reply(200, result)
          }
          reply(404, { error: 'not_found' })
        } catch (error) {
          reply(500, { error: error.message })
        }
      })
      await new Promise((resolve) => service.listen(FACILITATOR_PORT, '127.0.0.1', resolve))
      servers.push(service)
      facilitatorUrl = `http://127.0.0.1:${FACILITATOR_PORT}`
      console.log(`[INFO] Facilitator service on ${facilitatorUrl} (fee payer ${merchantId})`)
    } else {
      console.log(`[INFO] Using the hosted facilitator at ${facilitatorUrl}`)
    }

    // 2. The facilitator's public description, exactly what a resource server reads.
    const supported = await (await fetch(`${facilitatorUrl}/supported`)).json()
    const kind = supported.kinds.find((k) => k.network === X402_NETWORK && k.scheme === 'exact')
    if (!kind) throw new Error(`${facilitatorUrl} does not support exact payments on ${X402_NETWORK}`)
    console.log(`[LOG] GET /supported → exact on ${kind.network}, feePayer ${kind.extra.feePayer}`)

    // 3. The resource server reaches the facilitator over HTTP, like any hosted facilitator.
    const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register(X402_NETWORK, new ExactHederaScheme())
    const routes = {
      'GET /api/report': {
        accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: { amount: PRICE_TINYBARS, asset: HBAR_ASSET_ID } }],
        description: 'Derivatives risk report'
      }
    }
    const api = http.createServer(paywall(resourceServer, routes, { 'GET /api/report': () => ({ symbol: 'HBAR-PERP', volatilityIndex: 42.8 }) }))
    await new Promise((resolve) => api.listen(API_PORT, '127.0.0.1', resolve))
    servers.push(api)
    const url = `http://127.0.0.1:${API_PORT}/api/report`

    const offer = readPaymentRequired(await fetch(url)).accepts[0]
    console.log(`[LOG] 402 terms: ${formatHbar(offer.amount)} to ${offer.payTo}, fee payer ${offer.extra.feePayer}`)

    // 4. The agent pays as usual: it does not care who hosts the facilitator.
    const fetchWithPayment = wrapFetchWithPayment(fetch, createBuyer(agentId, agentKey, { maxTinybars: 2_000_000 }))
    const res = await fetchWithPayment(url)
    const receipt = readPaymentResponse(res)
    console.log(`[SUCCESS] HTTP ${res.status}, body: ${JSON.stringify(await res.json())}`)
    if (res.status !== 200 || !receipt?.success) throw new Error(`Payment was not settled: ${receipt?.errorReason || res.status}`)
    console.log(`[LOG] View on HashScan: ${getHashscanUrl(receipt.transaction)}`)

    // 5. The merchant's books for this sale: price received minus the fee it paid as facilitator.
    const mirrorId = receipt.transaction.replace('@', '-').replace(/\.(\d+)$/, '-$1')
    const record = await waitForMirror(async () => {
      const r = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions/${mirrorId}`)
      return r.ok ? (await r.json()).transactions?.[0] : null
    })
    if (record) {
      const sum = (list, id) => (list || []).filter((t) => t.account === id).reduce((total, t) => total + t.amount, 0)
      const net = (id) => sum(record.transfers, id) - sum(record.staking_reward_transfers, id)
      show.table([
        { party: 'agent', account: agentId, change: formatHbar(net(agentId)) },
        { party: 'merchant + facilitator', account: merchantId, change: `${formatHbar(net(merchantId))} (price ${formatHbar(PRICE_TINYBARS)} − fee ${formatHbar(record.charged_tx_fee)})` }
      ])
    }
    updateState('X402_SELF_HOSTED_TX_ID', receipt.transaction)

    console.log('\n KEY CONCEPT:')
    console.log('The facilitator is just an HTTP service with /supported, /verify and /settle.')
    console.log('Hosting it yourself removes the third party: the merchant co-signs and pays')
    console.log('the fee. Pointing the same code at a hosted facilitator is a URL change.')
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
