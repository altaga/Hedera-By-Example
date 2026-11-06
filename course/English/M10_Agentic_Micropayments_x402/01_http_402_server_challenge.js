/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 01: The HTTP 402 Payment Challenge
 * [CONCEPT] A paid API answers "402 Payment Required" with machine-readable terms
 * ============================================================================
 * [ KEY CONCEPT ]
 * x402 turns any HTTP endpoint into a pay-per-call API, and an AI agent can
 * pay it without a human or an API key.
 *
 * There are three roles:
 *   - the buyer (an AI agent or any client) wants a resource,
 *   - the resource server (the merchant's API) sells it,
 *   - the facilitator checks payments and submits them to Hedera.
 *
 * When a request arrives without a payment, the server does not ask for an API
 * key or redirect to a checkout page. It answers HTTP 402 with a PAYMENT-REQUIRED
 * header: Base64 JSON that says exactly what to pay (amount and asset), to whom
 * (payTo), on which network (hedera:testnet) and who pays the network fee
 * (extra.feePayer, the facilitator's account). An agent can read it and pay
 * without a human.
 *
 * In this lab you build the resource server with the official @x402/core and
 * @x402/hedera packages, call it without paying, and decode the challenge.
 *
 * [ LEARNABLE MOMENT ]
 * The 402 is free: nothing is signed and nothing reaches Hedera yet. The price is
 * an integer in the asset's smallest unit (tinybars for HBAR, whose asset id in
 * x402 is "0.0.0"), so there is no rounding between server and buyer.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://docs.hedera.com/solutions/ai/x402/merchant-integration
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 11: A2A Encrypted Handshake
 * - Next:     M10 Lab 02: The Agent Signs a Payment
 *
 * [ SEQUENCE ]
 * Server -> Facilitator: GET /supported (which networks, which feePayer)
 * Agent -> Server: GET /api/market-depth (no payment)
 * Server -> Agent: 402 + PAYMENT-REQUIRED (exact, hedera:testnet, amount, payTo, feePayer)
 * Note Agent: decodes the Base64 JSON and reads the terms
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account plays the facilitator (it pays network fees in later labs).
 * - Practice wallets: ACCOUNT_2 is the merchant that gets paid (payTo).
 * - Cost: free (no transaction is sent).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/01_http_402_server_challenge.js
 * ============================================================================
 */

import http from 'node:http'
import { x402ResourceServer } from '@x402/core/server'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HBAR_ASSET_ID } from '@x402/hedera'
import {
  getClient,
  updateState,
  show,
  X402_NETWORK,
  createLocalFacilitator,
  paywall,
  readPaymentRequired,
  formatHbar
} from '../M99_Utilities/index.js'

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = 4021
const ROUTE = '/api/market-depth'
const PRICE_TINYBARS = '1000000' // 0.01 ℏ

// ─── Main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- SESSION START: The HTTP 402 Payment Challenge ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const merchantId = process.env.ACCOUNT_2_ID
  if (!merchantId) throw new Error('Missing ACCOUNT_2_ID (the merchant). Create practice wallets or set it in .env.')

  let server
  try {
    // 1. The facilitator. Your account is its fee payer; it only answers /supported here.
    const { client: facilitator, feePayer } = createLocalFacilitator(operatorId, operatorKey)
    console.log(`[INFO] Facilitator fee payer: ${feePayer}`)
    console.log(`[INFO] Merchant (payTo):      ${merchantId}`)

    // 2. The resource server: which payment schemes it accepts, and which facilitator it trusts.
    const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactHederaScheme())

    // 3. The price list. One route, paid in HBAR (asset "0.0.0") with the "exact" scheme.
    const routes = {
      [`GET ${ROUTE}`]: {
        accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: { amount: PRICE_TINYBARS, asset: HBAR_ASSET_ID } }],
        description: 'Order-book depth for HBAR/USD',
        mimeType: 'application/json'
      }
    }
    const handlers = { [`GET ${ROUTE}`]: () => ({ pair: 'HBAR/USD', bids: [[0.281, 120000]], asks: [[0.283, 98000]] }) }

    // 4. Serve it over HTTP, like any API.
    server = http.createServer(paywall(resourceServer, routes, handlers))
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
    console.log(`[INFO] Paid API listening on http://127.0.0.1:${PORT}${ROUTE}`)

    // 5. Call it like a client that has never heard of payments.
    console.log(`\n[PROCESS] GET ${ROUTE} without any payment...`)
    const response = await fetch(`http://127.0.0.1:${PORT}${ROUTE}`)
    console.log(`[LOG] HTTP ${response.status} ${response.statusText || 'Payment Required'}`)
    console.log(`[LOG] PAYMENT-REQUIRED header: ${response.headers.get('payment-required').slice(0, 60)}… (Base64)`)
    if (response.status !== 402) throw new Error(`Expected HTTP 402, got ${response.status}`)

    // 6. Decode the challenge: this is everything a buyer needs to pay.
    const challenge = readPaymentRequired(response)
    console.log('\n[SUCCESS] Decoded PAYMENT-REQUIRED:')
    show.json(challenge)

    const offer = challenge.accepts[0]
    show.table([
      { field: 'x402Version', value: challenge.x402Version, meaning: 'protocol version' },
      { field: 'scheme', value: offer.scheme, meaning: 'pay this exact amount' },
      { field: 'network', value: offer.network, meaning: 'CAIP-2 id of Hedera testnet' },
      { field: 'asset', value: offer.asset, meaning: '0.0.0 is HBAR, otherwise an HTS token id' },
      { field: 'amount', value: offer.amount, meaning: `${formatHbar(offer.amount)} in tinybars` },
      { field: 'payTo', value: offer.payTo, meaning: 'merchant account that gets paid' },
      { field: 'extra.feePayer', value: offer.extra.feePayer, meaning: 'facilitator account that pays the network fee' },
      { field: 'maxTimeoutSeconds', value: offer.maxTimeoutSeconds, meaning: 'how long the offer stands' }
    ])

    updateState('X402_MERCHANT_ID', merchantId)
    updateState('X402_FEE_PAYER', offer.extra.feePayer)

    console.log('\n KEY CONCEPT:')
    console.log('The 402 is a price tag a machine can read. Nothing was signed or paid:')
    console.log('the buyer now knows the amount, the asset, the merchant and the fee payer,')
    console.log('and decides whether to pay. Lab 02 builds that payment.')
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    server?.close()
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
