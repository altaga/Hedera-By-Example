/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Autonomous Agent Financial Guardrails
 * [ CONCEPT ] Policy Engines, Spending Ceilings, and Circuit Breakers
 * ============================================================================
 * [ KEY CONCEPT ]
 * Financial Blast Radius: Giving an autonomous agent private keys without
 * programmatic guardrails is catastrophic—a recursive LLM loop or an adversary
 * exploiting prompt injection could drain thousands of dollars in minutes.
 * A production agent must evaluate every x402 challenge through a deterministic
 * Policy Engine that enforces daily caps, per-request ceilings, and merchant
 * allowlists before generating a cryptographic signature.
 * *
 * [ LEARNABLE MOMENT ]
 * Never give an autonomous agent an unbounded wallet. Enforcing hard daily spend limits, approved merchant allowlists, and emergency circuit breakers prevents runaway inference cost spirals.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/approve-an-allowance
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 04: HTS USDC Micropayments
 * - Next:     M10 Lab 06: Autonomous Market Agent
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/05_agent_budget_guardrails.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

class AgentPolicyEngine {
  constructor (config) {
    this.dailyLimitHbar = config.dailyLimitHbar
    this.maxPerRequestHbar = config.maxPerRequestHbar
    this.merchantAllowlist = new Set(config.allowedMerchants)
    this.currentDailySpend = 0
    this.circuitBreakerTripped = false
  }

  evaluate (request) {
    const { payee, amountHbar, resource } = request

    if (this.circuitBreakerTripped) {
      return { approved: false, reason: 'CIRCUIT_BREAKER_ACTIVE: Agent wallet is temporarily paused.' }
    }

    if (!this.merchantAllowlist.has(payee)) {
      return { approved: false, reason: `UNAUTHORIZED_PAYEE: Merchant ${payee} is not on the verified allowlist.` }
    }

    if (amountHbar > this.maxPerRequestHbar) {
      return { approved: false, reason: `CEILING_EXCEEDED: Requested ${amountHbar} HBAR exceeds max limit of ${this.maxPerRequestHbar} HBAR.` }
    }

    if (this.currentDailySpend + amountHbar > this.dailyLimitHbar) {
      return { approved: false, reason: `BUDGET_DEPLETED: Daily cumulative limit of ${this.dailyLimitHbar} HBAR would be exceeded.` }
    }

    // Approve and update state
    this.currentDailySpend += amountHbar
    return {
      approved: true,
      remainingDailyBudget: this.dailyLimitHbar - this.currentDailySpend,
      auditPayload: {
        timestamp: Date.now(),
        payee,
        amountHbar,
        resource
      }
    }
  }

  tripCircuitBreaker (reason) {
    this.circuitBreakerTripped = true
    return `EMERGENCY ALERT: Circuit breaker tripped. Reason: ${reason}`
  }
}

const main = async () => {
  console.log('--- SESSION START: Autonomous Agent Financial Guardrails ---\n')
  const { client, operatorId, network } = getClient()

  try {
    const verifiedMerchantA = operatorId.toString()
    const verifiedMerchantB = '0.0.98765'
    const rogueMerchant = '0.0.66699'

    console.log('[⚙️ PROCESS] Initializing Agent Deterministic Policy Engine...')
    const policy = new AgentPolicyEngine({
      dailyLimitHbar: 5.0,
      maxPerRequestHbar: 1.5,
      allowedMerchants: [verifiedMerchantA, verifiedMerchantB]
    })

    console.log('[📊 LOG] Daily Budget Limit:      5.0 HBAR')
    console.log('[📊 LOG] Max Cost Per Request:    1.5 HBAR')
    console.log(`[📊 LOG] Verified Merchants:      ${verifiedMerchantA}, ${verifiedMerchantB}`)

    // Scenario 1: Legitimate query within policy
    console.log('\n--- TEST SCENARIO 1: Legitimate Query ---')
    const req1 = { payee: verifiedMerchantA, amountHbar: 0.5, resource: '/api/v1/sentiment' }
    const res1 = policy.evaluate(req1)
    console.log(`[REQUEST] Payee: ${req1.payee} | Cost: ${req1.amountHbar} HBAR`)
    console.log(`[RESULT]  Approved: ${res1.approved} | Remaining Budget: ${res1.remainingDailyBudget} HBAR`)

    // Scenario 2: Price Gouging / Exorbitant Request
    console.log('\n--- TEST SCENARIO 2: Exorbitant Paywall Attack ---')
    const req2 = { payee: verifiedMerchantB, amountHbar: 12.0, resource: '/api/v1/private-weights' }
    const res2 = policy.evaluate(req2)
    console.log(`[REQUEST] Payee: ${req2.payee} | Cost: ${req2.amountHbar} HBAR`)
    console.log(`[RESULT]  Approved: ${res2.approved} | Rejection Reason: ${res2.reason}`)

    // Scenario 3: Unverified / Phishing Merchant
    console.log('\n--- TEST SCENARIO 3: Rogue Merchant Allowlist Check ---')
    const req3 = { payee: rogueMerchant, amountHbar: 0.2, resource: '/api/v1/malicious-proxy' }
    const res3 = policy.evaluate(req3)
    console.log(`[REQUEST] Payee: ${req3.payee} | Cost: ${req3.amountHbar} HBAR`)
    console.log(`[RESULT]  Approved: ${res3.approved} | Rejection Reason: ${res3.reason}`)

    // 4. Log Approved Spending to Immutable HCS Audit Log
    console.log('\n[⚙️ PROCESS] Anchoring approved payment audit event to Hedera Consensus Service...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('x402:agent_guardrail_audit')
      .freezeWith(client)
    const topicResponse = await topicTx.execute(client)
    const topicReceipt = await topicResponse.getReceipt(client)
    const auditTopicId = topicReceipt.topicId.toString()

    const auditMessage = JSON.stringify({
      agentAccount: operatorId.toString(),
      action: 'X402_PAYMENT_APPROVED',
      amountHbar: req1.amountHbar,
      payee: req1.payee,
      timestamp: Date.now()
    })

    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(auditTopicId)
      .setMessage(auditMessage)
      .freezeWith(client)
    const submitResponse = await submitTx.execute(client)
    const submitReceipt = await submitResponse.getReceipt(client)

    console.log(`[✅ SUCCESS] Audit Event Recorded on HCS Topic: ${auditTopicId}`)
    console.log(`[📊 LOG] Audit Message: ${auditMessage}`)

    updateState('X402_AUDIT_TOPIC_ID', auditTopicId)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Decentralized identity and spending guardrails protect the human owner')
    console.log('from financial liabilities. Anchoring spending audits to HCS creates an')
    console.log('irrefutable, tamper-proof record of every dollar spent by autonomous agents.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Guardrail simulation failed:', error.message)
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
