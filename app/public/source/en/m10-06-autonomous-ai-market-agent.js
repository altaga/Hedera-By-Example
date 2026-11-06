/**
 * ============================================================================
 * Lab 06: Autonomous AI Market Agent
 * [CONCEPT] Discover, Compare, Pay and Consume Without a Human
 * ============================================================================
 * [ KEY CONCEPT ]
 * End-to-End Economic Agency: The culmination of the Agentic Web is an AI that
 * finds competing paid services, reads each one's x402 quote, compares their
 * price-performance ratio, pays the best one on Hedera and consumes the result,
 * all within seconds, with no human, no account and no subscription with any
 * provider. A 402 costs nothing, so asking every provider for its price is free;
 * money moves once, to the provider the agent chose.
 * *
 * [ LEARNABLE MOMENT ]
 * The HTTP 402 is the whole integration: the agent needs no API key or contract with any provider, and the Hedera transaction id in PAYMENT-RESPONSE proves which provider it paid and how much.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 05: Financial Guardrails
 * - Next:     M10 Lab 07: Live AI Streaming Gateway
 *
 * [SEQUENCE]
 * Agent -> Providers: GET /api/v1/signals/macro (no payment)
 * Providers -> Agent: 402 quotes (price, payTo, feePayer)
 * Note Agent: Picks the best confidence per HBAR within budget
 * Agent -> Facilitator: PAYMENT-SIGNATURE for the chosen provider
 * Facilitator -> Hedera: Co-sign and submit
 * Provider -> Agent: 200 OK + signal
 *
 * [SIMULATED]
 * The three providers are simulated and all collect into ACCOUNT_2. Their 402 quotes follow x402, and the payment is real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the facilitator (it pays the network fee).
 * - Practice wallets: ACCOUNT_1 (agent) pays ACCOUNT_2 (the providers).
 * - Cost: <0.1 ℏ (network fees only); up to 0.02 ℏ moves between the practice wallets.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/06_autonomous_ai_market_agent.js
 * ============================================================================
 */

import {
  getClient,
  updateState,
  getHashscanUrl,
  ensureFunded,
  createPaymentRequired,
  signExactPayment,
  settleExactPayment
} from '../M99_Utilities/index.js'

const MARKETPLACE_PROVIDERS = [
  { id: 'provider-alpha', name: 'DeepAlpha Quant API', priceTinybars: 1_500_000, latencyMs: 120, confidenceRating: 0.94 },
  { id: 'provider-beta', name: 'Apex Hedge Feed', priceTinybars: 9_000_000, latencyMs: 45, confidenceRating: 0.98 }, // over budget
  { id: 'provider-gamma', name: 'OpenSentiment Oracle', priceTinybars: 600_000, latencyMs: 180, confidenceRating: 0.91 }
]
const MAX_PRICE_TINYBARS = 2_000_000 // 0.02 HBAR per request

const main = async () => {
  console.log('--- SESSION START: Autonomous Market Agent (The Complete Loop) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const providerAccount = process.env.ACCOUNT_2_ID

  if (!agentId || !agentKey || !providerAccount) {
    console.error('[FAILED] Missing credentials in .env (ACCOUNT_1 agent, ACCOUNT_2 provider).')
    process.exitCode = 1
    return
  }

  try {
    await ensureFunded(client, agentId, 1)
    console.log('[AGENT] Objective: Acquire macroeconomic market sentiment signal.')
    console.log(`[AGENT] Budget Policy: Max ${MAX_PRICE_TINYBARS / 1e8} HBAR per request.\n`)

    // 1. Discovery: each provider answers the unpaid request with its 402 quote (free)
    console.log('[PROCESS] Requesting /api/v1/signals/macro from every provider without paying...')
    const quotes = MARKETPLACE_PROVIDERS.map((provider) => ({
      provider,
      paymentRequired: createPaymentRequired({
        resource: '/api/v1/signals/macro',
        description: `${provider.name} macro signal`,
        payTo: providerAccount,
        amount: provider.priceTinybars,
        feePayer: operatorId.toString()
      })
    }))
    console.log(`[LOG] Received ${quotes.length} HTTP 402 quotes. Evaluating:\n`)

    // 2. Comparison: confidence per HBAR, among the quotes within budget
    const evaluated = quotes.map((q) => {
      const priceHbar = Number(q.paymentRequired.accepts[0].amount) / 1e8
      const withinBudget = Number(q.paymentRequired.accepts[0].amount) <= MAX_PRICE_TINYBARS
      const utilityScore = withinBudget ? q.provider.confidenceRating / priceHbar : 0
      console.log(`- ${q.provider.name}: ${priceHbar} HBAR | Confidence: ${q.provider.confidenceRating} | Within Budget: ${withinBudget ? 'YES' : 'NO'}`)
      return { ...q, priceHbar, withinBudget, utilityScore }
    })
    const selected = evaluated.filter((e) => e.withinBudget).sort((a, b) => b.utilityScore - a.utilityScore)[0]
    console.log(`\n[SUCCESS] Selected Optimal Provider: ${selected.provider.name}`)
    console.log(`[LOG] Best Utility Score: ${selected.utilityScore.toFixed(1)} confidence points per HBAR (Price: ${selected.priceHbar} HBAR)`)

    // 3. Pay only the selected provider: the agent signs, the facilitator settles
    console.log(`\n[PROCESS] Agent signing payment for ${selected.provider.name}...`)
    const payment = await signExactPayment(client, selected.paymentRequired, agentId, agentKey)
    console.log('[PROCESS] Facilitator verifying, co-signing and submitting...')
    const settlement = await settleExactPayment(client, payment, operatorKey)
    if (!settlement.success) throw new Error(`Settlement rejected: ${settlement.errorReason}`)
    console.log('\n[SUCCESS] On-Chain Settlement Finalized:')
    console.log(`[LOG] Consensus Status: ${settlement.status}`)
    console.log(`[LOG] Transaction ID:   ${settlement.transaction}`)
    console.log(`[EXPLORER] HashScan:    ${getHashscanUrl(settlement.transaction)}`)

    // 4. Ingest the unlocked intelligence
    console.log('\n[PROCESS] Provider verified the PAYMENT-RESPONSE. Ingesting unlocked intelligence payload...')
    const intelligencePayload = {
      source: selected.provider.name,
      macroIndicator: 'INFLATION_COOLING_EXPANSIONARY',
      marketBias: 'LONG_RISK_ASSETS',
      recommendedHedgeRatio: 0.15,
      paidWith: settlement.transaction
    }
    console.log('[LOG] RECEIVED INTELLIGENCE PAYLOAD:')
    console.log(JSON.stringify(intelligencePayload, null, 2))

    updateState('X402_MARKET_AGENT_TX_ID', settlement.transaction)
    updateState('X402_MARKET_AGENT_PROVIDER', selected.provider.name)

    console.log('\n KEY CONCEPT:')
    console.log('This completes the Machine Economy loop: the agent compared three quotes for')
    console.log('free, paid one micro-settlement on Hedera to the best provider, and consumed')
    console.log('the result without a human ever touching a checkout button.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Autonomous agent execution failed:', error.message)
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
