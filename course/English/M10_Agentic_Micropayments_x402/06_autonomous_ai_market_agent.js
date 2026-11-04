/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Autonomous Market Agent (The Complete Loop)
 * [CONCEPT] Autonomous Discovery, Evaluation, and Settlement
 * ============================================================================
 * [ KEY CONCEPT ]
 * End-to-End Economic Agency: The culmination of the Agentic Web is an AI that
 * discovers multiple competing paid services, compares their price-performance
 * ratio, negotiates access, settles payment autonomously on Hedera via x402,
 * and ingests the resulting intelligence—all within seconds, with zero human
 * intervention or subscription lock-in.
 * *
 * [ LEARNABLE MOMENT ]
 * The complete autonomous economy loop: an AI agent discovers a paid data endpoint, evaluates profitability, signs an x402 payment, settles on Hedera, and consumes the intelligence without human intervention.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hashgraph.com/
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 05: Financial Guardrails
 * - Next:     M10 Lab 07: Live AI Streaming Proxy Gateway
 *
 * [SEQUENCE]
 * Agent -> Registry: Find providers and quotes
 * Note Agent: Picks the best price/quality score
 * Agent -> Oracle: GET sentiment signal
 * Oracle -> Agent: 402 Payment Required
 * Agent -> Hedera: Pay 0.35 ℏ
 * Agent -> Oracle: Retry with payment proof
 * Oracle -> Agent: 200 OK + signal
 *
 * [SIMULATED]
 * The three providers and their quotes are simulated. The payment is real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/06_autonomous_ai_market_agent.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  TransferTransaction,
  Hbar,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

// Simulating 3 competing intelligence providers
const MARKETPLACE_PROVIDERS = [
  {
    id: 'provider-alpha',
    name: 'DeepAlpha Quant API',
    resource: '/api/v1/signals/macro',
    quotedPriceHbar: 0.8,
    latencyMs: 120,
    confidenceRating: 0.94
  },
  {
    id: 'provider-beta',
    name: 'Apex Hedge Feed',
    resource: '/api/v1/signals/macro',
    quotedPriceHbar: 2.5, // Exceeds budget ceiling
    latencyMs: 45,
    confidenceRating: 0.98
  },
  {
    id: 'provider-gamma',
    name: 'OpenSentiment Oracle',
    resource: '/api/v1/signals/macro',
    quotedPriceHbar: 0.35,
    latencyMs: 180,
    confidenceRating: 0.91
  }
]

const main = async () => {
  console.log('--- SESSION START: Autonomous Market Agent (The Complete Loop) ---\n')
  const { client, operatorId, operatorKey, network } = getClient()

  try {
    console.log('[AGENT] Objective: Acquire macroeconomic market sentiment signal.')
    console.log('[AGENT] Budget Policy: Max 1.0 HBAR per request.\n')

    // 1. Service Discovery and Comparison
    console.log('[PROCESS] Scanning decentralized registry for eligible providers...')
    console.log(`[LOG] Found ${MARKETPLACE_PROVIDERS.length} competing providers. Evaluating quotes:\n`)

    const evaluatedProviders = MARKETPLACE_PROVIDERS.map((provider) => {
      const withinBudget = provider.quotedPriceHbar <= 1.0
      // Calculate utility score: confidence / price
      const utilityScore = withinBudget ? (provider.confidenceRating / provider.quotedPriceHbar) : 0
      console.log(`- ${provider.name}: ${provider.quotedPriceHbar} HBAR | Confidence: ${provider.confidenceRating} | Within Budget: ${withinBudget ? 'YES' : 'NO'}`)
      return { ...provider, withinBudget, utilityScore }
    })

    // Filter and select best utility provider
    const eligibleProviders = evaluatedProviders.filter(p => p.withinBudget)
    eligibleProviders.sort((a, b) => b.utilityScore - a.utilityScore)
    const selectedProvider = eligibleProviders[0]

    console.log(`\n[SUCCESS] Selected Optimal Provider: ${selectedProvider.name}`)
    console.log(`[LOG] Best Utility Score: ${selectedProvider.utilityScore.toFixed(3)} (Price: ${selectedProvider.quotedPriceHbar} HBAR)`)

    // 2. Request Resource and Receive HTTP 402 Challenge
    console.log(`\n[PROCESS] Dispatching unauthenticated request to ${selectedProvider.name}...`)
    const challengeNonce = crypto.randomBytes(16).toString('hex')
    console.log(`[LOG] Server responded: HTTP 402 Payment Required (Nonce: ${challengeNonce})`)

    // 3. Autonomous Cryptographic Signing
    console.log('\n[PROCESS] Agent generating cryptographic payment signature...')
    const signerKey = PrivateKey.fromStringDer(operatorKey)
    const paymentIntent = {
      payer: operatorId.toString(),
      payee: operatorId.toString(), // Self-transfer simulation on testnet
      amount: selectedProvider.quotedPriceHbar,
      asset: 'HBAR',
      nonce: challengeNonce,
      timestamp: Date.now()
    }

    const serialized = JSON.stringify(paymentIntent)
    const signatureBytes = signerKey.sign(Buffer.from(serialized, 'utf8'))
    const signatureHex = Buffer.from(signatureBytes).toString('hex')
    console.log(`[SUCCESS] Signature generated: ${signatureHex.substring(0, 32)}...`)

    // 4. Zero-Gas Facilitator Sponsoring and Settling on Hedera
    console.log('\n[PROCESS] Submitting payment to Hedera network for consensus settlement...')
    const transferTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-selectedProvider.quotedPriceHbar))
      .addHbarTransfer(operatorId, new Hbar(selectedProvider.quotedPriceHbar))
      .setTransactionMemo(`x402:agent_loop:${selectedProvider.id}`)
      .freezeWith(client)

    const txResponse = await transferTx.execute(client)
    const receipt = await txResponse.getReceipt(client)
    const hashscanUrl = getHashscanUrl(txResponse)

    console.log('\n[SUCCESS] On-Chain Settlement Finalized:')
    console.log(`[LOG] Consensus Status: ${receipt.status.toString()}`)
    console.log(`[LOG] Transaction ID:  ${txResponse.transactionId.toString()}`)
    console.log(`[EXPLORER] HashScan:    ${hashscanUrl}`)

    // 5. Ingest Unlocked Intelligence
    console.log('\n[PROCESS] Server verified payment proof. Ingesting unlocked intelligence payload...')
    const intelligencePayload = {
      source: selectedProvider.name,
      macroIndicator: 'INFLATION_COOLING_EXPANSIONARY',
      marketBias: 'LONG_RISK_ASSETS',
      recommendedHedgeRatio: 0.15,
      timestamp: new Date().toISOString()
    }

    console.log('\n[LOG] RECEIVED INTELLIGENCE PAYLOAD:')
    console.dir(intelligencePayload, { depth: null })

    updateState('X402_MARKET_AGENT_TX_ID', txResponse.transactionId.toString())
    updateState('X402_MARKET_AGENT_PROVIDER', selectedProvider.name)

    console.log('\n KEY CONCEPT:')
    console.log('This completes the vision of the Machine Economy: AI agents discovering services,')
    console.log('evaluating trade-offs, paying micro-settlements on-chain via Hedera, and')
    console.log('delivering high-level intelligence without a human ever touching a checkout button.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Autonomous agent execution failed:', error.message)
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
