/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 03: The Facilitator Settles on Hedera
 * [CONCEPT] Verify, deliver, settle: the full x402 round trip with a real transfer
 * ============================================================================
 * [ KEY CONCEPT ]
 * This lab runs a whole x402 purchase over HTTP and settles it with a real
 * transfer on Hedera testnet.
 *
 * Step by step:
 *   1. GET without payment            → 402 + PAYMENT-REQUIRED
 *   2. GET with PAYMENT-SIGNATURE     → the server asks the facilitator to verify
 *   3. the server does the paid work  (runs the route handler)
 *   4. the facilitator settles        → adds its signature as fee payer and
 *                                       submits the transfer to Hedera
 *   5. 200 + PAYMENT-RESPONSE         → the Hedera transaction id, as a receipt
 *
 * The money goes straight from the agent to the merchant in one Hedera transfer:
 * no escrow, no smart contract, finality in a few seconds.
 *
 * [ LEARNABLE MOMENT ]
 * Who pays what: the agent's balance drops by exactly the price; the network fee
 * is charged to the facilitator, because the transaction id is its account.
 * Replay is impossible by construction: a Hedera transaction id can execute only
 * once, so sending the same PAYMENT-SIGNATURE again fails with DUPLICATE_TRANSACTION.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/how-it-works
 * - https://docs.hedera.com/solutions/ai/x402/facilitators
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 02: The Agent Signs a Payment
 * - Next:     M10 Lab 04: Pricing in Dollars with an HTS Stablecoin
 *
 * [ SEQUENCE ]
 * Agent -> Server: GET /api/forecast
 * Server -> Agent: 402 + PAYMENT-REQUIRED
 * Agent -> Server: GET /api/forecast + PAYMENT-SIGNATURE
 * Server -> Facilitator: verify
 * Note Server: runs the paid handler
 * Server -> Facilitator: settle
 * Facilitator -> Hedera: TransferTransaction signed by agent + fee payer
 * Hedera -> Facilitator: receipt SUCCESS
 * Server -> Agent: 200 + PAYMENT-RESPONSE (transaction id)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the facilitator and pays the network fee.
 * - Practice wallets: ACCOUNT_1 is the agent (pays the price), ACCOUNT_2 the merchant.
 * - Cost: 0.01 ℏ moves from ACCOUNT_1 to ACCOUNT_2; about 0.001 ℏ in fees for you.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/03_facilitator_settlement.js
 * ============================================================================
 */

import http from 'node:http'
import { x402ResourceServer } from '@x402/core/server'
import { encodePaymentSignatureHeader } from '@x402/core/http'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HBAR_ASSET_ID } from '@x402/hedera'
import {
  getClient,
  getHashscanUrl,
  getMirrorNodeBaseUrl,
  waitForMirror,
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
const PORT = 4023
const ROUTE = '/api/forecast'
const PRICE_TINYBARS = '1000000' // 0.01 ℏ

// ─── Main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- SESSION START: The Facilitator Settles on Hedera ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  if (!agentId || !agentKey || !merchantId) throw new Error('Missing ACCOUNT_1 (agent) or ACCOUNT_2 (merchant). Create practice wallets or set them in .env.')

  let server
  try {
    // The agent needs the price in its account (not gas). Top it up if it is nearly empty.
    await ensureFunded(client, agentId, 1)

    // 1. Merchant and facilitator. Hooks print what the server does on each request.
    const { client: facilitator, feePayer } = createLocalFacilitator(operatorId, operatorKey)
    const resourceServer = new x402ResourceServer(facilitator)
      .register(X402_NETWORK, new ExactHederaScheme())
      .onAfterVerify(async ({ result }) => console.log(`  [SERVER] facilitator verify → isValid: ${result.isValid}`))
      .onAfterSettle(async ({ result }) => console.log(`  [SERVER] facilitator settle → ${result.success ? result.transaction : result.errorReason}`))
      .onSettleFailure(async ({ error }) => console.log(`  [SERVER] settle failed → ${error?.message || error}`))
    const routes = {
      [`GET ${ROUTE}`]: {
        accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: { amount: PRICE_TINYBARS, asset: HBAR_ASSET_ID } }],
        description: 'Six-hour HBAR volatility forecast'
      }
    }
    const handlers = {
      [`GET ${ROUTE}`]: () => {
        console.log('  [SERVER] payment verified → running the paid handler')
        return { horizon: '6h', volatility: 0.042, signal: 'RANGE_BOUND' }
      }
    }
    server = http.createServer(paywall(resourceServer, routes, handlers))
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${PORT}${ROUTE}`

    // 2. First request: no payment, so the server answers 402 with its terms.
    console.log(`[PROCESS] Agent: GET ${ROUTE}`)
    const unpaid = await fetch(url)
    const challenge = readPaymentRequired(unpaid)
    console.log(`[LOG] HTTP ${unpaid.status}: ${formatHbar(challenge.accepts[0].amount)} to ${merchantId}`)

    // 3. The agent signs (Lab 02) and retries with the payment in PAYMENT-SIGNATURE.
    const agent = createBuyer(agentId, agentKey, { maxTinybars: 5_000_000 })
    const payment = await agent.createPaymentPayload(challenge)
    const paymentHeader = encodePaymentSignatureHeader(payment)
    console.log(`\n[PROCESS] Agent: GET ${ROUTE} with PAYMENT-SIGNATURE`)
    const paid = await fetch(url, { headers: { 'PAYMENT-SIGNATURE': paymentHeader } })
    const body = await paid.json()
    const receipt = readPaymentResponse(paid)
    console.log(`[SUCCESS] HTTP ${paid.status}, body: ${JSON.stringify(body)}`)
    console.log('[LOG] PAYMENT-RESPONSE:')
    show.json(receipt)
    if (paid.status !== 200 || !receipt?.success) throw new Error(`Payment was not settled: ${receipt?.errorReason || paid.status}`)
    console.log(`[LOG] View on HashScan: ${getHashscanUrl(receipt.transaction)}`)

    // 4. Ask the Mirror Node who paid what in that transaction.
    const mirrorId = receipt.transaction.replace('@', '-').replace(/\.(\d+)$/, '-$1')
    const record = await waitForMirror(async () => {
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions/${mirrorId}`)
      return res.ok ? (await res.json()).transactions?.[0] : null
    })
    if (record) {
      // Net HBAR change per account. Staking rewards Hedera pays out in the same transaction are left out.
      const sum = (list, id) => (list || []).filter((t) => t.account === id).reduce((total, t) => total + t.amount, 0)
      const net = (id) => sum(record.transfers, id) - sum(record.staking_reward_transfers, id)
      console.log(`\n[LOG] Mirror Node: ${record.result}, fee ${formatHbar(record.charged_tx_fee)} charged to ${record.transaction_id.split('-')[0]}`)
      show.table([
        { role: 'agent (buyer)', account: agentId, change: formatHbar(net(agentId)) },
        { role: 'merchant (payTo)', account: merchantId, change: formatHbar(net(merchantId)) },
        { role: 'facilitator (fee payer)', account: feePayer, change: formatHbar(net(feePayer)) }
      ])
    }

    // 5. Replay: send the exact same payment again.
    console.log('\n[TEST] Replaying the same PAYMENT-SIGNATURE...')
    const replay = await fetch(url, { headers: { 'PAYMENT-SIGNATURE': paymentHeader } })
    const replayReceipt = readPaymentResponse(replay)
    const hederaStatus = (replayReceipt?.errorMessage || '').match(/status (\w+)/)?.[1]
    console.log(`[SUCCESS] HTTP ${replay.status}: ${replayReceipt?.errorReason || 'rejected'}${hederaStatus ? `, Hedera says ${hederaStatus}` : ''}`)
    if (replay.status === 200) throw new Error('The replayed payment was accepted')

    updateState('X402_SETTLED_TX_ID', receipt.transaction)

    console.log('\n KEY CONCEPT:')
    console.log('One Hedera transfer moved the price from the agent to the merchant, and')
    console.log('the facilitator paid the fee. The transaction id doubles as the receipt and')
    console.log('as replay protection: the same payment can never execute twice.')
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
