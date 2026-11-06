/**
 * ============================================================================
 * Lab 01: Server HTTP 402 Challenge Generation
 * [CONCEPT] Machine-Readable Payment Challenges
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Paywall Header: Instead of redirecting an AI agent to a checkout page or
 * demanding a static API key, the server answers HTTP 402 (Payment Required)
 * with a PAYMENT-REQUIRED header: Base64 JSON that states exactly what to pay
 * (amount and asset), to whom (payTo), on which network (hedera:testnet) and
 * which account will pay the network fee (extra.feePayer, the facilitator).
 * This turns any HTTP endpoint into a pay-per-call API.
 * *
 * [ LEARNABLE MOMENT ]
 * HTTP 402 bridges Web2 APIs with Web3 settlement: the challenge is free, nothing is signed or sent to Hedera yet, and the price is an integer in the asset's smallest unit (tinybars for HBAR, whose x402 asset id is "0.0.0"), so server and agent never disagree on rounding.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 11: Encrypted A2A Communication (HCS-10)
 * - Next:     M10 Lab 02: Autonomous Agent Payment Signature
 *
 * [ SEQUENCE ]
 * Agent -> Server: GET /api/v1/alpha-intelligence/market-depth
 * Note Server: No API key, token or cookie
 * Server -> Agent: 402 + PAYMENT-REQUIRED (amount, asset, payTo, feePayer)
 *
 * [ SIMULATED ]
 * The HTTP request and server run in the same process; no web server is started.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the facilitator (it pays the network fee in Lab 03).
 * - Practice wallets: ACCOUNT_2 is the merchant that gets paid.
 * - Cost: free (no transaction is sent).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/01_http_402_server_challenge.js
 * ============================================================================
 */

import { getClient, updateState, encodeHeader, decodeHeader, show, X402_NETWORK, HBAR_ASSET } from '../M99_Utilities/index.js'

const create402Challenge = (resourcePath, priceTinybars, payTo, feePayer) => {
  // x402 v2 "PaymentRequired": the resource, and the list of payment options the server accepts.
  const paymentRequired = {
    x402Version: 2,
    error: 'Payment required',
    resource: {
      url: resourcePath,
      description: 'Alpha intelligence market-depth feed',
      mimeType: 'application/json'
    },
    accepts: [{
      scheme: 'exact', // pay this exact amount
      network: X402_NETWORK, // hedera:testnet
      amount: String(priceTinybars), // integer, smallest unit of the asset
      asset: HBAR_ASSET, // "0.0.0" = HBAR, otherwise an HTS token id
      payTo, // the merchant's account
      maxTimeoutSeconds: 120, // a Hedera transaction is valid for 120 s
      extra: { feePayer } // the facilitator account that pays the network fee
    }]
  }

  // HTTP 402: the same terms travel Base64-encoded in the PAYMENT-REQUIRED header.
  return {
    status: 402,
    headers: { 'PAYMENT-REQUIRED': encodeHeader(paymentRequired) },
    body: paymentRequired
  }
}

const main = async () => {
  console.log('--- SESSION START: x402 Server Challenge Generator ---\n')
  const { client, operatorId } = getClient()
  const merchantId = process.env.ACCOUNT_2_ID

  if (!merchantId) {
    console.error('[FAILED] Missing credentials in .env (ACCOUNT_2, the merchant).')
    process.exitCode = 1
    return
  }

  try {
    const resourcePath = '/api/v1/alpha-intelligence/market-depth'
    const priceTinybars = 1_000_000 // 0.01 HBAR per request

    console.log(`[PROCESS] Simulating unauthenticated request to: ${resourcePath}`)
    console.log('[INFO] No API Key, OAuth Bearer token, or Session Cookie present.')

    // 1. The server answers a protected request with payment terms instead of the data.
    console.log('\n[PROCESS] Server interceptor triggering HTTP 402 challenge...')
    const challenge = create402Challenge(resourcePath, priceTinybars, merchantId, operatorId.toString())
    const accept = challenge.body.accepts[0]

    console.log('\n[SUCCESS] HTTP 402 Payment Required Challenge Generated:')
    console.log(`[LOG] HTTP Status:       ${challenge.status} Payment Required`)
    console.log(`[LOG] Target Resource:   ${challenge.body.resource.url}`)
    console.log(`[LOG] x402 Version:      ${challenge.body.x402Version}`)
    console.log(`[LOG] Scheme / Network:  ${accept.scheme} / ${accept.network}`)
    console.log(`[LOG] Price:             ${accept.amount} tinybars (${priceTinybars / 1e8} HBAR, asset ${accept.asset})`)
    console.log(`[LOG] Pay To (merchant): ${accept.payTo}`)
    console.log(`[LOG] Fee Payer:         ${accept.extra.feePayer} (the facilitator)`)
    console.log(`[LOG] PAYMENT-REQUIRED:  ${challenge.headers['PAYMENT-REQUIRED'].substring(0, 48)}...`)
    console.log('\n[LOG] The same header, decoded (this is what the agent reads):')
    show.json(decodeHeader(challenge.headers['PAYMENT-REQUIRED']))

    // 2. Persist the header for Lab 02, as an agent would receive it.
    updateState('X402_PAYMENT_REQUIRED', challenge.headers['PAYMENT-REQUIRED'])

    console.log('\n KEY CONCEPT:')
    console.log('The HTTP 402 response is completely self-describing. Any compliant machine')
    console.log('agent can decode the header, check the price against its budget policy and')
    console.log('build the payment by itself. Nothing has been signed or paid yet.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Failed to generate 402 challenge:', error.message)
    process.exitCode = 1
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
