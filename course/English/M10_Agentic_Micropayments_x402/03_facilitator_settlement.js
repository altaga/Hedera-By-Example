/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Zero-Gas Facilitator Settlement
 * [CONCEPT] Verify, Co-Sign and Submit
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Sponsored Settlement: The facilitator receives the agent's signed
 * transfer and checks it before it agrees to pay the fee: it is a plain
 * transfer, the transaction id is the facilitator's own account, it has not
 * expired, it moves exactly the quoted amount to the merchant, and the agent's
 * signature is valid. Then it adds its own signature as fee payer and submits
 * it. The server answers 200 with a PAYMENT-RESPONSE header that carries the
 * Hedera transaction id as the receipt.
 * *
 * [ LEARNABLE MOMENT ]
 * Replay protection comes from Hedera itself: a transaction id can only execute once, so submitting the same payment again fails with DUPLICATE_TRANSACTION, and an old one fails because it expired. No nonce registry is needed.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/facilitators
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 02: Agent Payment Signature
 * - Next:     M10 Lab 04: HTS USDC Micropayments
 *
 * [SEQUENCE]
 * Agent -> Server: Retry with PAYMENT-SIGNATURE
 * Server -> Facilitator: Verify the signed transfer
 * Note Facilitator: Fee payer, expiry, amount, payee, agent signature
 * Facilitator -> Hedera: Co-sign as fee payer and submit
 * Hedera -> Facilitator: Receipt SUCCESS
 * Server -> Agent: 200 OK + PAYMENT-RESPONSE (transaction id)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the facilitator and pays the network fee.
 * - Practice wallets: ACCOUNT_1 (agent) pays 0.01 ℏ to ACCOUNT_2 (merchant).
 * - Run first: M10 Lab 02 (this lab reads what it saved).
 * - Cost: about 0.003 ℏ in fees for you; 0.01 ℏ moves between the practice wallets.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/03_facilitator_settlement.js
 * ============================================================================
 */

import { PublicKey, Transaction, TransferTransaction } from '@hiero-ledger/sdk'
import {
  getClient,
  getState,
  updateState,
  getHashscanUrl,
  getMirrorNodeBaseUrl,
  parsePrivateKey,
  waitForMirror,
  ensureFunded,
  decodeHeader,
  encodeHeader,
  signExactPayment,
  getTransactionRecord
} from '../M99_Utilities/index.js'

// The agent's public key, as the network knows it (Mirror Node).
const fetchPublicKey = async (accountId) => {
  const account = await waitForMirror(async () => {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
    return res.ok ? res.json() : null
  })
  if (!account) throw new Error(`Could not read the key of ${accountId} from the Mirror Node.`)
  const { key } = account
  return key._type === 'ED25519' ? PublicKey.fromStringED25519(key.key) : PublicKey.fromStringECDSA(key.key)
}

const main = async () => {
  console.log('--- SESSION START: Zero-Gas Facilitator Settlement ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const header = getState('X402_PAYMENT_SIGNATURE')

  if (!header) {
    console.error('[FAILED] Missing X402_PAYMENT_SIGNATURE in state. Run M10 Lab 02 first.')
    process.exitCode = 1
    return
  }

  try {
    // The agent must hold the price (not gas). Top it up if a practice wallet is nearly empty.
    await ensureFunded(client, agentId, 1)

    // 1. Ingest the PAYMENT-SIGNATURE header from Lab 02
    console.log('[PROCESS] Facilitator decoding PAYMENT-SIGNATURE header...')
    let payment = decodeHeader(header)
    let tx = Transaction.fromBytes(Buffer.from(payment.payload.transaction, 'base64'))

    // A Hedera transaction is only valid for 120 s after it was signed.
    const expiresAt = tx.transactionId.validStart.toDate().getTime() + tx.transactionValidDuration * 1000
    if (Date.now() > expiresAt - 10_000) {
      console.log('[INFO] The payment signed in Lab 02 has expired (valid 120 s). The agent signs it again (Lab 02 step).')
      payment = await signExactPayment(client, { resource: payment.resource, accepts: [payment.accepted] }, agentId, agentKey)
      tx = Transaction.fromBytes(Buffer.from(payment.payload.transaction, 'base64'))
    }
    const terms = payment.accepted
    const amount = Number(terms.amount)
    console.log(`[LOG] Transaction ID:  ${tx.transactionId.toString()}`)
    console.log(`[LOG] Terms:           ${amount / 1e8} HBAR to ${terms.payTo}, fee payer ${terms.extra.feePayer}`)

    // 2. Verify before paying the fee
    console.log('\n[PROCESS] Verifying the signed transfer...')
    if (!(tx instanceof TransferTransaction)) throw new Error('REJECTED: not a plain transfer.')
    console.log('[SUCCESS] It is a plain TransferTransaction (no other operations).')

    if (tx.transactionId.accountId.toString() !== operatorId.toString() || terms.extra.feePayer !== operatorId.toString()) {
      throw new Error('REJECTED: the transaction id does not belong to this facilitator.')
    }
    console.log(`[SUCCESS] Fee payer is this facilitator (${operatorId}).`)

    const moves = [...tx.hbarTransfers].map(([id, hbar]) => ({ account: id.toString(), tinybars: Number(hbar.toTinybars()) }))
    const debit = moves.find((m) => m.tinybars < 0)
    const credit = moves.find((m) => m.tinybars > 0)
    if (moves.length !== 2 || credit.account !== terms.payTo || credit.tinybars !== amount || debit.tinybars !== -amount) {
      throw new Error('REJECTED: the transfer does not match the quoted amount and payee.')
    }
    if (debit.account === operatorId.toString()) throw new Error('REJECTED: the facilitator would be paying the price.')
    console.log(`[SUCCESS] Moves exactly ${amount / 1e8} HBAR from ${debit.account} to ${credit.account}.`)

    const agentPublicKey = await fetchPublicKey(debit.account)
    if (!agentPublicKey.verifyTransaction(tx)) throw new Error('REJECTED: the payer did not sign this transfer.')
    console.log(`[SUCCESS] Signature of ${debit.account} is valid (key read from the Mirror Node).`)

    // 3. Co-sign as fee payer and submit to Hedera
    console.log('\n[PROCESS] Facilitator co-signing as fee payer and submitting to Hedera...')
    await tx.sign(parsePrivateKey(operatorKey))
    const txResponse = await tx.execute(client)
    const receipt = await txResponse.getReceipt(client)
    const hashscanUrl = getHashscanUrl(txResponse)
    console.log('\n[SUCCESS] Transaction Settled On-Chain:')
    console.log(`[LOG] Consensus Status: ${receipt.status.toString()}`)
    console.log(`[LOG] Transaction ID:   ${txResponse.transactionId.toString()}`)
    console.log(`[EXPLORER] HashScan:    ${hashscanUrl}`)

    // 4. The server unlocks the resource: HTTP 200 with PAYMENT-RESPONSE
    const settlement = { success: true, network: terms.network, payer: debit.account, transaction: txResponse.transactionId.toString() }
    console.log('\n[SUCCESS] Server Unlocks Resource: HTTP 200 OK')
    console.log(`[LOG] PAYMENT-RESPONSE: ${encodeHeader(settlement).substring(0, 48)}...  →  ${JSON.stringify(settlement)}`)
    console.log('[LOG] Response Body:    {"alpha_signal": "BULLISH_CONVERGENCE", "confidence": 0.942}')

    // 5. Who paid what, according to the Mirror Node
    const record = await waitForMirror(() => getTransactionRecord(settlement.transaction))
    if (record) {
      const net = (id) => record.transfers.filter((t) => t.account === id).reduce((sum, t) => sum + t.amount, 0) -
        (record.staking_reward_transfers || []).filter((t) => t.account === id).reduce((sum, t) => sum + t.amount, 0)
      console.log('\n[PROCESS] Reading the settled transfer from the Mirror Node...')
      console.log(`[LOG] Agent ${debit.account}:      ${net(debit.account) / 1e8} HBAR (exactly the price)`)
      console.log(`[LOG] Merchant ${credit.account}:  +${net(credit.account) / 1e8} HBAR`)
      console.log(`[LOG] Facilitator ${operatorId}: ${net(operatorId.toString()) / 1e8} HBAR (the network fee)`)
    }

    // 6. Replay: submit exactly the same payment again
    console.log('\n[PROCESS] Replaying the same PAYMENT-SIGNATURE...')
    try {
      await (await Transaction.fromBytes(tx.toBytes()).execute(client)).getReceipt(client)
      throw new Error('The replayed payment was accepted.')
    } catch (error) {
      if (!/DUPLICATE_TRANSACTION/.test(String(error.status || error.message))) throw error
      console.log('[SUCCESS] Rejected by Hedera: DUPLICATE_TRANSACTION. A payment can only settle once.')
    }

    updateState('X402_SETTLED_TX_ID', settlement.transaction)

    console.log('\n KEY CONCEPT:')
    console.log('The settlement proof is indisputable: one Hedera transfer moved the price')
    console.log('from the agent to the merchant, the facilitator paid the fee, and the same')
    console.log('payment can never settle twice. No chargebacks, no card fees, no unpaid invoices.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Facilitator settlement failed:', error.message)
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
