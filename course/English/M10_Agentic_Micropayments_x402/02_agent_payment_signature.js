/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 02: The Agent Signs a Payment
 * [CONCEPT] An x402 payment on Hedera is a signed transfer nobody has sent yet
 * ============================================================================
 * [ KEY CONCEPT ]
 * When the buyer gets a 402, its x402 client builds a Hedera
 * TransferTransaction from the terms: -amount from the buyer, +amount to
 * payTo.
 *
 * Two details make it an x402 payment:
 *   - its transaction id belongs to the facilitator (extra.feePayer), so the
 *     facilitator, not the buyer, pays the network fee;
 *   - the buyer signs it but does not submit it. The signed bytes travel back to
 *     the server, Base64-encoded, in the PAYMENT-SIGNATURE header.
 *
 * The buyer needs no HBAR for gas: it only needs the price.
 *
 * In this lab the agent signs a payment, you open it to see what is inside,
 * and the facilitator verifies it. Nothing is submitted, so no money moves.
 *
 * [ LEARNABLE MOMENT ]
 * A signed transfer is not yet a payment. It becomes one only when the fee payer
 * adds its signature and submits it, and it expires about 120 seconds after it
 * was signed (Hedera's transaction valid duration). Verification also catches
 * tampering: change any term the buyer accepted and the facilitator rejects it.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/pay-with-x402
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/transactions/transaction-id
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 01: The HTTP 402 Payment Challenge
 * - Next:     M10 Lab 03: The Facilitator Settles on Hedera
 *
 * [ SEQUENCE ]
 * Agent -> Server: GET /api/sentiment
 * Server -> Agent: 402 + PAYMENT-REQUIRED
 * Note Agent: builds TransferTransaction, transaction id = feePayer, signs it
 * Agent -> Facilitator: verify(payment, terms)
 * Facilitator -> Agent: isValid: true (nothing submitted)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the facilitator.
 * - Practice wallets: ACCOUNT_1 is the agent (buyer), ACCOUNT_2 the merchant.
 * - Cost: free (the payment is verified, not submitted).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/02_agent_payment_signature.js
 * ============================================================================
 */

import http from 'node:http'
import { x402ResourceServer } from '@x402/core/server'
import { encodePaymentSignatureHeader } from '@x402/core/http'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HBAR_ASSET_ID } from '@x402/hedera'
import {
  getClient,
  show,
  X402_NETWORK,
  createBuyer,
  createLocalFacilitator,
  paywall,
  readPaymentRequired,
  describePayment,
  toPrivateKey,
  formatHbar
} from '../M99_Utilities/index.js'

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = 4022
const ROUTE = '/api/sentiment'
const PRICE_TINYBARS = '1000000' // 0.01 ℏ

// ─── Main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- SESSION START: The Agent Signs a Payment ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  if (!agentId || !agentKey || !merchantId) throw new Error('Missing ACCOUNT_1 (agent) or ACCOUNT_2 (merchant). Create practice wallets or set them in .env.')

  let server
  try {
    // 1. Merchant side, as in Lab 01: a paid route and a facilitator (your account pays fees).
    const { client: facilitator, feePayer } = createLocalFacilitator(operatorId, operatorKey)
    const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactHederaScheme())
    const routes = {
      [`GET ${ROUTE}`]: {
        accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: { amount: PRICE_TINYBARS, asset: HBAR_ASSET_ID } }],
        description: 'Market sentiment score'
      }
    }
    server = http.createServer(paywall(resourceServer, routes, { [`GET ${ROUTE}`]: () => ({ sentiment: 0.72 }) }))
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

    // 2. The agent asks for the resource and receives the 402 terms.
    const response = await fetch(`http://127.0.0.1:${PORT}${ROUTE}`)
    const challenge = readPaymentRequired(response)
    console.log(`[LOG] HTTP ${response.status}: pay ${formatHbar(challenge.accepts[0].amount)} to ${merchantId}, fee payer ${feePayer}`)

    // 3. The agent's x402 client. It refuses assets it was not told about, so allow HBAR with a cap.
    const agent = createBuyer(agentId, agentKey, { maxTinybars: 5_000_000 }) // at most 0.05 ℏ per payment

    // 4. Sign the payment. This only builds and signs a transaction; nothing is sent to Hedera.
    console.log('\n[PROCESS] Agent signs the payment...')
    const payment = await agent.createPaymentPayload(challenge)

    // 5. Look inside: who pays the fee, who moves what, who has signed.
    const inside = describePayment(payment)
    console.log('[SUCCESS] Payment payload built. Inside it:')
    show.table([
      { field: 'transaction type', value: inside.type },
      { field: 'transaction id', value: inside.transactionId },
      { field: 'fee payer (tx id account)', value: `${inside.feePayer} (the facilitator)` },
      ...inside.hbarTransfers.map((t) => ({ field: `transfer ${t.accountId}`, value: formatHbar(t.amount) })),
      { field: 'signed by', value: inside.signers.length === 1 && inside.signers[0] === toPrivateKey(agentKey).publicKey.toString() ? 'the agent only' : inside.signers.join(', ') },
      { field: 'valid for', value: `${inside.validForSeconds} s after signing` }
    ])
    const header = encodePaymentSignatureHeader(payment)
    console.log(`[LOG] It travels as PAYMENT-SIGNATURE: ${header.slice(0, 60)}… (${header.length} chars)`)

    // 6. The facilitator verifies it: signature (via the Mirror Node), amounts, payee, fee payer, balance.
    console.log('\n[PROCESS] Facilitator verifies the payment (read-only)...')
    const verdict = await facilitator.verify(payment, payment.accepted)
    console.log(`[SUCCESS] verify → isValid: ${verdict.isValid}, payer: ${verdict.payer}`)
    if (!verdict.isValid) throw new Error(`verify failed: ${verdict.invalidReason} ${verdict.invalidMessage || ''}`)

    // 7. Tampering: a payment for a different merchant than the one in the terms is rejected.
    const tampered = { ...payment, accepted: { ...payment.accepted, payTo: operatorId } }
    const rejected = await facilitator.verify(tampered, payment.accepted)
    console.log(`[TEST] Same signature, payTo changed → isValid: ${rejected.isValid} (${rejected.invalidReason})`)

    console.log('\n KEY CONCEPT:')
    console.log('The agent signed a transfer whose transaction id belongs to the facilitator.')
    console.log('It is valid but unsent: no HBAR moved. In Lab 03 the facilitator adds its')
    console.log('signature, pays the fee and submits it to Hedera.')
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
