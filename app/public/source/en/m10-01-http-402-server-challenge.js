/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Server HTTP 402 Challenge Generation
 * [CONCEPT] Machine-Readable Payment Challenges
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Paywall Header: Instead of redirecting an AI agent to a web browser
 * checkout page or demanding a static API key, the server responds with
 * HTTP 402 (Payment Required) and provides deterministic parameters:
 * recipient, amount, asset, network, scheme, and a cryptographic nonce.
 * This turns any standard HTTP endpoint into a pay-per-call API.
 * *
 * [ LEARNABLE MOMENT ]
 * HTTP 402 Payment Required bridges Web2 APIs with Web3 micro-settlement: servers issue deterministic payment challenges specifying the price in tinybars or USDC before delivering computational resources.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 11: A2A Encrypted Handshake
 * - Next:     M10 Lab 02: Agent Payment Signature
 *
 * [SEQUENCE]
 * Agent -> Server: GET /api/v1/alpha-intelligence/market-depth
 * Note Server: No API key, token or cookie
 * Server -> Agent: 402 Payment Required (price, payee, nonce, expiry)
 *
 * [SIMULATED]
 * The HTTP request and server run in the same process; no web server is started.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/01_http_402_server_challenge.js
 * ============================================================================
 */

import crypto from 'crypto'
import { getClient, updateState } from '../M99_Utilities/index.js'

const create402Challenge = (resourcePath, costHbar, payeeAccountId, network = 'testnet') => {
  // A random nonce makes each challenge single-use, so a payment proof cannot be replayed.
  const nonce = crypto.randomBytes(16).toString('hex')
  const timestamp = Date.now()
  const expiresAt = timestamp + 120000 // 2 minutes challenge validity

  // HTTP 402 Payment Required: the x402 headers say what to pay, to whom and on which network.
  const paymentChallenge = {
    status: 402,
    headers: {
      'WWW-Authenticate': 'x402',
      'x402-version': '1.0',
      'x402-network': `hedera:${network}`,
      'x402-scheme': 'exact',
      'x402-payee': payeeAccountId,
      'x402-amount': costHbar.toString(),
      'x402-asset': 'HBAR',
      'x402-nonce': nonce,
      'x402-expires': expiresAt.toString(),
      'x402-resource': resourcePath
    },
    body: {
      error: 'Payment Required',
      message: `Access to ${resourcePath} requires an on-chain settlement proof.`,
      settlementScheme: 'exact',
      details: {
        network: `hedera:${network}`,
        payee: payeeAccountId,
        cost: `${costHbar} HBAR`,
        nonce,
        validUntil: new Date(expiresAt).toISOString()
      }
    }
  }

  return paymentChallenge
}

const main = async () => {
  console.log('--- SESSION START: x402 Server Challenge Generator ---\n')
  const { client, operatorId, network } = getClient()

  try {
    const resourcePath = '/api/v1/alpha-intelligence/market-depth'
    const queryCostHbar = 0.5 // 0.5 HBAR per request

    console.log(`[PROCESS] Simulating unauthenticated request to: ${resourcePath}`)
    console.log('[INFO] No API Key, OAuth Bearer token, or Session Cookie present.')

    console.log('\n[PROCESS] Server interceptor triggering HTTP 402 challenge...')
    // The server answers a protected request with a payment challenge instead of the data.
    const challenge = create402Challenge(resourcePath, queryCostHbar, operatorId.toString(), network)

    console.log('\n[SUCCESS] HTTP 402 Payment Required Challenge Generated:')
    console.log(`[LOG] HTTP Status:       ${challenge.status} Payment Required`)
    console.log(`[LOG] Target Resource:   ${challenge.headers['x402-resource']}`)
    console.log(`[LOG] Required Network:  ${challenge.headers['x402-network']}`)
    console.log(`[LOG] Scheme:            ${challenge.headers['x402-scheme']}`)
    console.log(`[LOG] Payee Address:     ${challenge.headers['x402-payee']}`)
    console.log(`[LOG] Required Cost:     ${challenge.headers['x402-amount']} ${challenge.headers['x402-asset']}`)
    console.log(`[LOG] Cryptographic Nonce: ${challenge.headers['x402-nonce']}`)
    console.log(`[LOG] Expires At:        ${challenge.body.details.validUntil}`)

    // Persist challenge for Lab 02
    updateState('X402_CHALLENGE_RESOURCE', resourcePath)
    updateState('X402_CHALLENGE_AMOUNT', queryCostHbar)
    updateState('X402_CHALLENGE_PAYEE', operatorId.toString())
    updateState('X402_CHALLENGE_NONCE', challenge.headers['x402-nonce'])
    updateState('X402_CHALLENGE_EXPIRES', challenge.headers['x402-expires'])

    console.log('\n KEY CONCEPT:')
    console.log('The HTTP 402 response is completely self-describing. Any compliant machine')
    console.log('agent can inspect the headers, evaluate whether the cost meets its budget')
    console.log('policy, and construct an on-chain cryptographic settlement proof autonomously.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Failed to generate 402 challenge:', error.message)
    process.exit(1)
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
