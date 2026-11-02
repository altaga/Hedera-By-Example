/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Zero-Gas Facilitator Settlement
 * [ CONCEPT ] Sponsored On-Chain Execution & Settlement Proofs
 * ============================================================================
 * [ KEY CONCEPT ]
 * Fee Decoupling: In traditional Web3, the caller must always hold native gas
 * tokens to execute any action. Hedera's x402 facilitator pattern decouples
 * the network fee from the payment asset: the Facilitator acts as the operator
 * submitting the transaction, paying the fractions of a cent in HBAR network fees,
 * while executing the authorized asset transfer from the agent to the merchant.
 * *
 * [ LEARNABLE MOMENT ]
 * A settlement facilitator sponsors network execution fees and aggregates micro-transactions, ensuring that end-user agents experience zero-gas micro-payments without managing complex transaction fee balances.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-1068
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 02: Agent Payment Signature
 * - Next:     M10 Lab 04: HTS USDC Micropayments
 *
 * [ SEQUENCE ]
 * Agent -> Server: Request with PAYMENT-SIGNATURE
 * Server -> Facilitator: Verify signature and single-use nonce
 * Facilitator -> Hedera: TransferTransaction 0.5 ℏ
 * Hedera -> Facilitator: Receipt SUCCESS
 * Server -> Agent: 200 OK + PAYMENT-RESPONSE (txId) + data
 *
 * [ SIMULATED ]
 * Payer and payee are the same account, so the settlement is a real transfer to yourself.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M10 Lab 02 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/03_facilitator_settlement.js
 * ============================================================================
 */

import {
  TransferTransaction,
  Hbar,
  PublicKey,
  AccountId
} from '@hiero-ledger/sdk'
import { getClient, getState, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

// In-memory nonce replay registry for the facilitator
const processedNonces = new Set()

const verifyAgentSignature = (signedProof) => {
  const { payload, signature, publicKey } = signedProof
  const serialized = JSON.stringify(payload)
  const messageBytes = Buffer.from(serialized, 'utf8')
  const signatureBytes = Buffer.from(signature, 'hex')

  const pubKey = PublicKey.fromString(publicKey)
  return pubKey.verify(messageBytes, signatureBytes)
}

const main = async () => {
  console.log('--- SESSION START: Zero-Gas Facilitator Settlement ---\n')
  const { client, operatorId, network } = getClient()

  try {
    // 1. Ingest base64 PAYMENT-SIGNATURE from Lab 02
    const headerValue = getState('X402_PAYMENT_HEADER')
    if (!headerValue) {
      throw new Error('Missing X402_PAYMENT_HEADER in state.json. Run Lab 02 first.')
    }

    console.log('[⚙️ PROCESS] Facilitator decoding PAYMENT-SIGNATURE header...')
    const signedProof = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8'))
    const { payload } = signedProof

    console.log(`[📊 LOG] Payer Account:    ${payload.payer}`)
    console.log(`[📊 LOG] Payee Account:    ${payload.payee}`)
    console.log(`[📊 LOG] Transfer Amount:  ${payload.amount} ${payload.asset}`)
    console.log(`[📊 LOG] Target Nonce:     ${payload.nonce}`)

    // 2. Cryptographic and Replay Verification
    console.log('\n[⚙️ PROCESS] Verifying cryptographic signature and single-use nonce...')
    const isValidSignature = verifyAgentSignature(signedProof)
    if (!isValidSignature) {
      throw new Error('CRYPTOGRAPHIC REJECTION: Payment signature does not match payer public key.')
    }
    console.log('[✅ SUCCESS] Cryptographic signature valid.')

    if (processedNonces.has(payload.nonce)) {
      throw new Error(`REPLAY REJECTION: Nonce ${payload.nonce} has already been settled.`)
    }
    if (Date.now() > Number(payload.expiresAt)) {
      throw new Error('TIMEOUT REJECTION: Challenge signature has expired.')
    }
    processedNonces.add(payload.nonce)
    console.log('[✅ SUCCESS] Anti-replay checks passed. Nonce registered as spent.')

    // 3. Facilitator executes on-chain settlement on Hedera
    console.log('\n[⚙️ PROCESS] Facilitator broadcasting settlement transaction to Hedera...')
    console.log('[ℹ️ INFO] Facilitator sponsors network gas; agent only provides authorized balance.')

    const amountHbar = Number(payload.amount)
    const payerId = AccountId.fromString(payload.payer)
    const payeeId = AccountId.fromString(payload.payee)

    // Execute transfer: payer -> payee
    // (In local testnet simulation where operator is both, we execute an atomic transfer)
    const transferTx = await new TransferTransaction()
      .addHbarTransfer(payerId, new Hbar(-amountHbar))
      .addHbarTransfer(payeeId, new Hbar(amountHbar))
      .setTransactionMemo(`x402:exact:${payload.nonce.substring(0, 8)}`)
      .freezeWith(client)

    const txResponse = await transferTx.execute(client)
    const receipt = await txResponse.getReceipt(client)
    const hashscanUrl = getHashscanUrl(txResponse)

    console.log('\n[✅ SUCCESS] Transaction Settled On-Chain:')
    console.log(`[📊 LOG] Consensus Status: ${receipt.status.toString()}`)
    console.log(`[📊 LOG] Transaction ID:  ${txResponse.transactionId.toString()}`)
    console.log(`[🔗 EXPLORER] HashScan:    ${hashscanUrl}`)

    // 4. Server issues HTTP 200 OK with PAYMENT-RESPONSE header
    const paymentResponseHeader = JSON.stringify({
      settled: true,
      protocol: 'x402',
      txId: txResponse.transactionId.toString(),
      hashscan: hashscanUrl,
      timestamp: Date.now()
    })

    console.log('\n[✅ SUCCESS] Server Unlocks Resource: HTTP 200 OK')
    console.log(`[📊 LOG] PAYMENT-RESPONSE: ${paymentResponseHeader}`)
    console.log('[📊 LOG] Response Body:   {"alpha_signal": "BULLISH_CONVERGENCE", "confidence": 0.942, "depth": 14000}')

    // Persist for tracking
    updateState('X402_SETTLED_TX_ID', txResponse.transactionId.toString())
    updateState('X402_SETTLED_HASHSCAN', hashscanUrl)

    console.log('\n💡 KEY CONCEPT:')
    console.log('The settlement proof is indisputable. The merchant serves the data because')
    console.log('the transaction has already reached finality on Hedera (~2.5 seconds).')
    console.log('No chargebacks, no credit card processing fees, no unpaid invoices.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Facilitator settlement failed:', error.message)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
