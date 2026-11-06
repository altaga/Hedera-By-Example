/**
 * ============================================================================
 * Lab 02: Autonomous Agent Payment Signature
 * [CONCEPT] A Signed Transfer Nobody Has Sent Yet
 * ============================================================================
 * [ KEY CONCEPT ]
 * Gasless Authorization: When an AI agent accepts a 402, it does not sign a
 * loose "intent" message. It builds the real Hedera TransferTransaction from
 * the terms (-amount from the agent, +amount to payTo) and signs it. Two
 * details make it an x402 payment: its transaction id belongs to the
 * facilitator (extra.feePayer), so the facilitator pays the network fee, and
 * the agent never submits it. The signed bytes go back to the server,
 * Base64-encoded, in the PAYMENT-SIGNATURE header.
 * *
 * [ LEARNABLE MOMENT ]
 * Autonomous agents cannot hold credit cards, and they should not need gas either: with the fee payer in the transaction id, the agent only needs the price. Its signature covers every byte, so nobody can change the amount or the payee without invalidating it.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/pay-with-x402
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/transactions/transaction-id
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 01: Server 402 Challenge
 * - Next:     M10 Lab 03: Facilitator Settlement
 *
 * [SEQUENCE]
 * Server -> Agent: 402 + PAYMENT-REQUIRED (0.01 ℏ, payTo, feePayer)
 * Note Agent: Checks its budget policy (max 0.05 ℏ)
 * Note Agent: Builds TransferTransaction, transaction id = feePayer, signs it
 * Agent -> Server: Retry with PAYMENT-SIGNATURE header
 *
 * [ BEFORE YOU RUN ]
 * - Practice wallets: ACCOUNT_1 is the agent that signs.
 * - Run first: M10 Lab 01 (this lab reads what it saved).
 * - Cost: free (the payment is signed, not sent).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/02_agent_payment_signature.js
 * ============================================================================
 */

import { Hbar, TransactionId, TransferTransaction } from '@hiero-ledger/sdk'
import { getClient, getState, updateState, parsePrivateKey, decodeHeader, encodeHeader } from '../M99_Utilities/index.js'

const MAX_PRICE_PER_CALL_TINYBARS = 5_000_000 // the agent's own limit: 0.05 HBAR

const main = async () => {
  console.log('--- SESSION START: Autonomous Agent Payment Signature ---\n')
  const { client } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const header = getState('X402_PAYMENT_REQUIRED')

  if (!agentId || !agentKey) {
    console.error('[FAILED] Missing credentials in .env (ACCOUNT_1, the agent).')
    process.exitCode = 1
    return
  }
  if (!header) {
    console.error('[FAILED] Missing X402_PAYMENT_REQUIRED in state. Run M10 Lab 01 first.')
    process.exitCode = 1
    return
  }

  try {
    // 1. Decode the 402 challenge from Lab 01
    console.log('[PROCESS] Agent decoding PAYMENT-REQUIRED header...')
    const paymentRequired = decodeHeader(header)
    const accept = paymentRequired.accepts[0]
    const amount = Number(accept.amount)
    console.log(`[LOG] Target Resource: ${paymentRequired.resource.url}`)
    console.log(`[LOG] Quoted Price:    ${amount} tinybars (${amount / 1e8} HBAR)`)
    console.log(`[LOG] Pay To:          ${accept.payTo}`)
    console.log(`[LOG] Fee Payer:       ${accept.extra.feePayer}`)

    // 2. Autonomous policy evaluation (budget guardrail)
    console.log(`\n[PROCESS] Evaluating internal budget policy (Max Allowed: ${MAX_PRICE_PER_CALL_TINYBARS / 1e8} HBAR)...`)
    if (accept.network !== 'hedera:testnet' || accept.asset !== '0.0.0') {
      throw new Error(`Unsupported payment option: ${accept.asset} on ${accept.network}`)
    }
    if (amount > MAX_PRICE_PER_CALL_TINYBARS) {
      throw new Error(`Quoted price (${amount / 1e8} HBAR) exceeds agent policy ceiling (${MAX_PRICE_PER_CALL_TINYBARS / 1e8} HBAR).`)
    }
    console.log('[SUCCESS] Quoted price is within the spending limit. Approving payment.')

    // 3. Build the transfer: agent -> merchant, with the facilitator's account in the transaction id
    console.log('\n[PROCESS] Building the TransferTransaction from the 402 terms...')
    const transferTx = new TransferTransaction()
      .addHbarTransfer(agentId, Hbar.fromTinybars(-amount))
      .addHbarTransfer(accept.payTo, Hbar.fromTinybars(amount))
      // The transaction id's account pays the network fee: the facilitator, not the agent.
      .setTransactionId(TransactionId.generate(accept.extra.feePayer))
      .freezeWith(client)

    // 4. Sign with the agent key only. Nothing is sent to Hedera.
    console.log('[PROCESS] Signing the transfer with the agent key (not submitting it)...')
    const signedTx = await transferTx.sign(parsePrivateKey(agentKey))
    const paymentPayload = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted: accept,
      payload: { transaction: Buffer.from(signedTx.toBytes()).toString('base64') }
    }
    const paymentSignatureHeader = encodeHeader(paymentPayload)

    console.log('\n[SUCCESS] x402 Payment Payload Generated:')
    console.log(`[LOG] Transaction ID:     ${signedTx.transactionId.toString()}`)
    console.log(`[LOG] Fee paid by:        ${signedTx.transactionId.accountId.toString()} (the facilitator)`)
    console.log(`[LOG] Transfers:          ${agentId} -${amount / 1e8} HBAR, ${accept.payTo} +${amount / 1e8} HBAR`)
    console.log(`[LOG] Valid for:          ${signedTx.transactionValidDuration} s after signing`)
    console.log(`[LOG] Header Size:        ${paymentSignatureHeader.length} bytes (base64)`)
    console.log(`[LOG] PAYMENT-SIGNATURE:  ${paymentSignatureHeader.substring(0, 48)}...`)

    // Persist for Lab 03 (Facilitator Settlement)
    updateState('X402_PAYMENT_SIGNATURE', paymentSignatureHeader)

    console.log('\n KEY CONCEPT:')
    console.log('The agent signed a real Hedera transfer, but it is not a payment yet: only')
    console.log('the facilitator in the transaction id can complete and submit it, and it')
    console.log('expires 120 seconds after signing. Run Lab 03 now to settle it.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Failed to sign the payment:', error.message)
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
