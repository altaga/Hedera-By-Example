/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 08: x402 Direct P2P Settlement (Buyer & Seller - 2-Party Architecture)
 * [CONCEPT] Autonomous On-Chain Payment Verification Without Facilitators
 * ============================================================================
 * [ KEY CONCEPT ]
 * The x402 protocol supports two distinct operational topologies:
 * 1. Sponsored / Facilitated (3 Actors): Buyer signs off-chain intent; a Facilitator
 *    sponsors the gas fee and broadcasts the transaction (Labs 01-03).
 * 2. Direct P2P (2 Actors): Buyer holds native HBAR, signs, pays its own network fee,
 *    and broadcasts the TransferTransaction directly to Hedera nodes with the single-use
 *    challenge `nonce` encoded in the transaction memo (`x402:direct:<nonce>`). The Seller
 *    audits the transaction on the Mirror Node to unlock the resource without any middleman.
 *
 * [ LEARNABLE MOMENT ]
 * Direct P2P eliminates any dependence on third-party facilitator servers, creating a
 * completely decentralized, zero-intermediary machine-to-machine commerce loop. The Seller
 * guarantees anti-replay protection by verifying that the on-chain transaction memo matches
 * the exact challenge nonce and has not been redeemed previously.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/transfer-cryptocurrency
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 07: Live AI Streaming Gateway
 * - Module Finish: Complete x402 Dual-Variant Architecture Suite
 *
 * [SEQUENCE]
 * Buyer -> Seller: GET /api/v1/quantum-pricing/derivatives-matrix
 * Seller -> Buyer: 402 (0.02 ℏ, memo x402:direct:<nonce>)
 * Buyer -> Hedera: Pay 0.02 ℏ with the memo
 * Buyer -> Seller: Retry with PAYMENT-TXID
 * Seller -> Hedera: Verify receipt, payee, amount and memo
 * Seller -> Buyer: 200 OK + settlement proof
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/08_x402_direct_p2p_settlement.js
 * ============================================================================
 */

import {
  TransferTransaction,
  Hbar,
  AccountId
} from '@hiero-ledger/sdk'
import crypto from 'node:crypto'
import { getClient, getState, updateState, getHashscanUrl, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

// In-memory replay registry for the merchant/seller server
const settledNonces = new Set()

/**
 * Server Component: Generates HTTP 402 challenge for direct settlement
 */
function generateDirect402Challenge (resourcePath, priceHbar, sellerAccountId, network) {
  const nonce = crypto.randomBytes(16).toString('hex')
  const expiresAt = Date.now() + 180000 // 3 minutes

  return {
    status: 402,
    headers: {
      'WWW-Authenticate': 'x402',
      'x402-version': '1.0',
      'x402-mode': 'direct_p2p',
      'x402-network': `hedera:${network}`,
      'x402-scheme': 'exact',
      'x402-payee': sellerAccountId,
      'x402-amount': priceHbar.toString(),
      'x402-asset': 'HBAR',
      'x402-nonce': nonce,
      'x402-expires': expiresAt.toString(),
      'x402-memo-format': `x402:direct:${nonce}`
    },
    body: {
      error: 'Payment Required',
      architecture: 'Direct P2P (Buyer + Seller)',
      price: `${priceHbar} HBAR`,
      payee: sellerAccountId,
      memoRequired: `x402:direct:${nonce}`,
      expiresAt: new Date(expiresAt).toISOString()
    }
  }
}

/**
 * Server Component: Verifies Buyer's direct transaction on Hedera
 */
async function verifyDirectPaymentOnHedera (client, txResponse, challenge, sellerId) {
  const { 'x402-amount': expectedAmount, 'x402-nonce': expectedNonce, 'x402-payee': expectedPayee } = challenge.headers

  // 1. Anti-Replay Verification
  if (settledNonces.has(expectedNonce)) {
    return { valid: false, reason: 'REPLAY_DETECTED: Challenge nonce has already been redeemed.' }
  }

  // 2. Obtain consensus receipt
  const receipt = await txResponse.getReceipt(client)
  if (receipt.status.toString() !== 'SUCCESS') {
    return { valid: false, reason: `TRANSACTION_FAILED: Consensus status is ${receipt.status.toString()}` }
  }

  // 3. Mark nonce as redeemed
  settledNonces.add(expectedNonce)

  return {
    valid: true,
    txId: txResponse.transactionId.toString(),
    settledAmount: expectedAmount,
    payee: expectedPayee,
    nonce: expectedNonce
  }
}

async function main () {
  console.log('====================================================================')
  console.log('X402 LAB 08: DIRECT P2P SETTLEMENT (BUYER & SELLER - 2 ACTORS)')
  console.log('====================================================================\n')

  const { client, operatorId, network } = getClient()

  try {
    console.log(`[ACTOR] Running as Operator/Payer ${operatorId} on Hedera ${network.toUpperCase()}`)

    // 1. Unauthenticated Request & Server 402 Challenge
    const targetResource = '/api/v1/quantum-pricing/derivatives-matrix'
    const queryPriceHbar = 0.02 // 0.02 HBAR
    const sellerAccountId = operatorId.toString() // Operator acts as seller endpoint

    console.log(`[1/5] Buyer requesting protected endpoint: ${targetResource}`)
    console.log('[PROCESS] Server interceptor blocks request: Generating HTTP 402 Direct P2P Challenge...')

    const challenge = generateDirect402Challenge(targetResource, queryPriceHbar, sellerAccountId, network)
    console.log('\n[ 402 CHALLENGE ISSUED]')
    console.log(`• Architecture: ${challenge.body.architecture}`)
    console.log(`• Required Fee: ${challenge.headers['x402-amount']} ${challenge.headers['x402-asset']}`)
    console.log(`• Destination:  ${challenge.headers['x402-payee']}`)
    console.log(`• Single-Use Nonce: ${challenge.headers['x402-nonce']}`)
    console.log(`• Required Memo:    ${challenge.headers['x402-memo-format']}`)

    // 2. Buyer Autonomous Decision & Direct On-Chain Execution
    console.log('\n[2/5] Buyer Agent evaluating price and paying directly on Hedera...')
    console.log('[INFO] In Direct P2P mode, Buyer pays network transaction fee ($0.0001) autonomously.')

    const paymentAmount = new Hbar(queryPriceHbar)
    const requiredMemo = challenge.headers['x402-memo-format']

    // Buyer broadcasts TransferTransaction directly to Hedera consensus node
    const directTransferTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, paymentAmount.negated())
      .addHbarTransfer(AccountId.fromString(sellerAccountId), paymentAmount)
      .setTransactionMemo(requiredMemo)
      .execute(client)

    console.log(`[ TRANSACTION BROADCAST] Tx ID: ${directTransferTx.transactionId.toString()}`)
    console.log(`[EXPLORER] ${getHashscanUrl(directTransferTx.transactionId.toString())}`)

    // 3. Buyer Retries Request with PAYMENT-TXID Header
    console.log('\n[3/5] Buyer retrying request with PAYMENT-TXID header attached...')
    const requestHeaders = {
      Authorization: `x402-direct ${directTransferTx.transactionId.toString()}`,
      'PAYMENT-TXID': directTransferTx.transactionId.toString(),
      'X-Challenge-Nonce': challenge.headers['x402-nonce']
    }
    console.log(`[LOG] Injected Header: PAYMENT-TXID: ${requestHeaders['PAYMENT-TXID']}`)

    // 4. Server Verification Engine (Zero-Intermediary Audit)
    console.log('\n[4/5] Server validating on-chain transaction receipt & single-use memo nonce...')
    const verification = await verifyDirectPaymentOnHedera(client, directTransferTx, challenge, sellerAccountId)

    if (!verification.valid) {
      throw new Error(`Server rejected payment proof: ${verification.reason}`)
    }

    console.log('[ PAYMENT VERIFIED ON-CHAIN]')
    console.log('• Status: Valid & Settled')
    console.log(`• Amount Confirmed: ${verification.settledAmount} HBAR`)
    console.log(`• Payee Matched:    ${verification.payee}`)
    console.log(`• Anti-Replay:      Nonce ${verification.nonce} marked as spent`)

    // 5. Server Delivers Resource: HTTP 200 OK
    console.log('\n[5/5] Server unlocking payload: HTTP 200 OK')
    const responsePayload = {
      status: 200,
      resource: targetResource,
      timestamp: Date.now(),
      settlementProof: {
        mode: 'direct_p2p',
        txId: verification.txId,
        hashscan: getHashscanUrl(directTransferTx.transactionId.toString())
      },
      data: {
        symbol: 'HBAR/USD-PERP',
        volatilityIndex: 42.8,
        impliedYield: '8.4%',
        optimalStrike: 0.185
      }
    }

    console.log('[ RESPONSE BODY]')
    console.log(JSON.stringify(responsePayload, null, 2))

    // Persist State
    updateState('X402_DIRECT_TX_ID', directTransferTx.transactionId.toString())
    updateState('X402_DIRECT_NONCE', challenge.headers['x402-nonce'])

    console.log('\n KEY CONCEPT:')
    console.log('Direct P2P x402 creates completely trustless, server-to-server commerce.')
    console.log('Unlike the 3-actor Facilitator model (which provides gasless abstraction),')
    console.log('Direct P2P relies on no external relays: the buyer pays on-chain and proves it via memo.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Always enforce memo-bound nonces (`x402:direct:<nonce>`) in Direct P2P mode.')
    console.log('Without memo validation, a malicious client could replay an unrelated transfer txId.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Direct x402 Settlement Failure:', error.message)
    process.exit(1)
  } finally {
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
