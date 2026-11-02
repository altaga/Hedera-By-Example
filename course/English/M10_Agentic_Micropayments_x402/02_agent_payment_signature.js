/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Autonomous Agent Payment Signature
 * [ CONCEPT ] Cryptographic Intent-to-Pay Signatures
 * ============================================================================
 * [ KEY CONCEPT ]
 * Replay-Protected Authorization: When an AI agent agrees to pay for an API
 * response, it signs a deterministic payload binding the exact amount, payee,
 * server nonce, and expiry timestamp using its private key. Because the nonce
 * is unique and single-use, malicious intermediaries cannot replay the signature
 * to drain the agent's account.
 * *
 * [ LEARNABLE MOMENT ]
 * Autonomous AI models cannot hold credit cards or enter billing passwords. Signing payment intents with cryptographic keys allows software agents to purchase per-call intelligence permissionlessly.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/keys-and-signatures
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 01: Server 402 Challenge
 * - Next:     M10 Lab 03: Facilitator Settlement
 *
 * [ SEQUENCE ]
 * Server -> Agent: 402 challenge (0.5 ℏ, payee, nonce)
 * Note Agent: Checks its budget policy (max 1 ℏ)
 * Note Agent: Signs the payment authorization with its key
 * Agent -> Server: Retry with PAYMENT-SIGNATURE header
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M10 Lab 01 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/02_agent_payment_signature.js
 * ============================================================================
 */

import crypto from 'crypto'
import { PrivateKey } from '@hiero-ledger/sdk'
import { getClient, getState, updateState } from '../M99_Utilities/index.js'

const signPaymentIntent = (signerKey, paymentPayload) => {
  // Normalize payload to deterministic JSON string
  const serialized = JSON.stringify(paymentPayload)
  const messageBytes = Buffer.from(serialized, 'utf8')

  // Sign using Hedera's cryptographic key signer
  const signatureBytes = signerKey.sign(messageBytes)
  const signatureHex = Buffer.from(signatureBytes).toString('hex')

  return {
    payload: paymentPayload,
    signature: signatureHex,
    publicKey: signerKey.publicKey.toStringDer()
  }
}

const main = async () => {
  console.log('--- SESSION START: Autonomous Agent Payment Signature ---\n')
  const { client, operatorId, operatorKey, network } = getClient()

  try {
    // 1. Retrieve challenge from Lab 01
    const resource = getState('X402_CHALLENGE_RESOURCE') || '/api/v1/alpha-intelligence/market-depth'
    const amount = Number(getState('X402_CHALLENGE_AMOUNT')) || 0.5
    const payee = getState('X402_CHALLENGE_PAYEE') || operatorId.toString()
    const nonce = getState('X402_CHALLENGE_NONCE') || crypto.randomBytes(16).toString('hex')
    const expiresAt = Number(getState('X402_CHALLENGE_EXPIRES')) || (Date.now() + 120000)

    console.log('[⚙️ PROCESS] Agent parsing HTTP 402 challenge parameters...')
    console.log(`[📊 LOG] Target Resource: ${resource}`)
    console.log(`[📊 LOG] Quoted Price:   ${amount} HBAR`)
    console.log(`[📊 LOG] Payee Account:  ${payee}`)
    console.log(`[📊 LOG] Challenge Nonce:${nonce}`)

    // 2. Autonomous Policy Evaluation (Budget Guardrail)
    const MAX_PRICE_PER_CALL_HBAR = 1.0 // Agent's internal limit
    console.log(`\n[⚙️ PROCESS] Evaluating internal budget policy (Max Allowed: ${MAX_PRICE_PER_CALL_HBAR} HBAR)...`)

    if (amount > MAX_PRICE_PER_CALL_HBAR) {
      throw new Error(`Quoted price (${amount} HBAR) exceeds agent policy ceiling (${MAX_PRICE_PER_CALL_HBAR} HBAR).`)
    }
    console.log('[✅ SUCCESS] Quoted price is within autonomous spending limit. Approving payment intent.')

    // 3. Construct deterministic payment authorization payload
    const paymentPayload = {
      protocol: 'x402',
      version: '1.0',
      network: `hedera:${network}`,
      scheme: 'exact',
      payer: operatorId.toString(),
      payee,
      amount: amount.toString(),
      asset: 'HBAR',
      nonce,
      expiresAt,
      timestamp: Date.now()
    }

    // 4. Cryptographically sign the intent using the agent's private key
    console.log('\n[⚙️ PROCESS] Signing payment authorization proof with agent key...')
    const signerKey = PrivateKey.fromStringDer(operatorKey)
    const signedProof = signPaymentIntent(signerKey, paymentPayload)

    // Encode into standard x402 header value
    const paymentHeaderValue = Buffer.from(JSON.stringify(signedProof)).toString('base64')

    console.log('\n[✅ SUCCESS] Cryptographic Payment Proof Generated:')
    console.log(`[📊 LOG] Payer Account:    ${paymentPayload.payer}`)
    console.log(`[📊 LOG] Public Key (DER): ${signedProof.publicKey.substring(0, 32)}...`)
    console.log(`[📊 LOG] Signature (Hex):  ${signedProof.signature.substring(0, 32)}...`)
    console.log(`[📊 LOG] Header Size:      ${paymentHeaderValue.length} bytes (base64)`)
    console.log(`[📊 LOG] PAYMENT-SIGNATURE: ${paymentHeaderValue.substring(0, 48)}...`)

    // Persist for Lab 03 Facilitator Settlement
    updateState('X402_PAYMENT_PAYLOAD', JSON.stringify(paymentPayload))
    updateState('X402_PAYMENT_SIGNATURE', signedProof.signature)
    updateState('X402_PAYMENT_HEADER', paymentHeaderValue)

    console.log('\n💡 KEY CONCEPT:')
    console.log('The agent signs proof of authorization, NOT raw gas or network plumbing.')
    console.log('The signature proves that the owner authorized a transfer of 0.5 HBAR')
    console.log('specifically for nonce ' + nonce + '. Intermediaries cannot modify the amount')
    console.log('or divert funds to a different payee without invalidating the cryptographic signature.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Failed to sign payment intent:', error.message)
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
