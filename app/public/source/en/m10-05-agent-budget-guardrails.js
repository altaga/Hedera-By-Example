/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Autonomous Agent Financial Guardrails
 * [CONCEPT] Deterministic Spending Policies and Immutable Audit Logs
 * ============================================================================
 * [ KEY CONCEPT ]
 * Financial Blast Radius: Giving an autonomous agent private keys without
 * programmatic guardrails is catastrophic: a recursive LLM loop or a prompt
 * injection could drain the wallet in minutes. A production agent evaluates
 * every x402 challenge through a deterministic Policy Engine (per-request
 * ceiling, daily budget, merchant allowlist, accepted network and asset)
 * before it signs anything. A rejected 402 never produces a signature, so
 * nothing can be settled.
 * *
 * [ LEARNABLE MOMENT ]
 * Guardrails belong to the payer, not the server: the server writes the terms, so the agent must check them itself. Anchoring each decision to HCS gives the human owner a tamper-proof record of what the agent paid and what it refused.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/pay-with-x402
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 04: HTS USDC Micropayments
 * - Next:     M10 Lab 06: Autonomous Market Agent
 *
 * [SEQUENCE]
 * Server -> Agent: 402 (0.01 ℏ, verified merchant)
 * Note Agent: Policy approves, signs, facilitator settles
 * Server -> Agent: 402 (5 ℏ, verified merchant)
 * Note Agent: Policy rejects: ceiling exceeded, nothing signed
 * Server -> Agent: 402 (0.01 ℏ, unknown merchant)
 * Note Agent: Policy rejects: payee not on the allowlist
 * Agent -> Hedera: Audit log of the three decisions on HCS
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the facilitator and pays the audit log.
 * - Practice wallets: ACCOUNT_1 (agent) pays ACCOUNT_2 (verified merchant).
 * - Cost: <0.1 ℏ (network fees; the audit topic is created once and reused); 0.01 ℏ moves between the practice wallets.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/05_agent_budget_guardrails.js
 * ============================================================================
 */

import { TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import {
  getClient,
  updateState,
  getHashscanUrl,
  ensureFunded,
  reuseTopic,
  createPaymentRequired,
  signExactPayment,
  settleExactPayment
} from '../M99_Utilities/index.js'

class AgentPolicyEngine {
  constructor (config) {
    this.dailyLimitTinybars = config.dailyLimitTinybars
    this.maxPerRequestTinybars = config.maxPerRequestTinybars
    this.merchantAllowlist = new Set(config.allowedMerchants)
    this.currentDailySpend = 0
  }

  // Checks the decoded PAYMENT-REQUIRED terms before anything is signed.
  evaluate (paymentRequired) {
    const { payTo, amount, network, asset } = paymentRequired.accepts[0]
    const tinybars = Number(amount)

    if (network !== 'hedera:testnet' || asset !== '0.0.0') {
      return { approved: false, reason: `UNSUPPORTED_ASSET: ${asset} on ${network}` }
    }
    if (!this.merchantAllowlist.has(payTo)) {
      return { approved: false, reason: `UNAUTHORIZED_PAYEE: Merchant ${payTo} is not on the verified allowlist.` }
    }
    if (tinybars > this.maxPerRequestTinybars) {
      return { approved: false, reason: `CEILING_EXCEEDED: ${tinybars / 1e8} HBAR exceeds the ${this.maxPerRequestTinybars / 1e8} HBAR per-request limit.` }
    }
    if (this.currentDailySpend + tinybars > this.dailyLimitTinybars) {
      return { approved: false, reason: `BUDGET_DEPLETED: the ${this.dailyLimitTinybars / 1e8} HBAR daily limit would be exceeded.` }
    }

    this.currentDailySpend += tinybars
    return { approved: true, remainingDailyBudget: (this.dailyLimitTinybars - this.currentDailySpend) / 1e8 }
  }
}

const main = async () => {
  console.log('--- SESSION START: Autonomous Agent Financial Guardrails ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const verifiedMerchant = process.env.ACCOUNT_2_ID
  const rogueMerchant = '0.0.66699' // an account the agent has never agreed to pay

  if (!agentId || !agentKey || !verifiedMerchant) {
    console.error('[FAILED] Missing credentials in .env (ACCOUNT_1 agent, ACCOUNT_2 merchant).')
    process.exitCode = 1
    return
  }

  try {
    await ensureFunded(client, agentId, 1)

    console.log('[PROCESS] Initializing Agent Deterministic Policy Engine...')
    const policy = new AgentPolicyEngine({
      dailyLimitTinybars: 5_000_000, // 0.05 HBAR per day
      maxPerRequestTinybars: 2_000_000, // 0.02 HBAR per request
      allowedMerchants: [verifiedMerchant]
    })
    console.log('[LOG] Daily Budget Limit:   0.05 HBAR')
    console.log('[LOG] Max Cost Per Request: 0.02 HBAR')
    console.log(`[LOG] Verified Merchants:   ${verifiedMerchant}`)

    const challenge = (payTo, tinybars, resource) => createPaymentRequired({ resource, description: resource, payTo, amount: tinybars, feePayer: operatorId.toString() })
    const decisions = []

    // Scenario 1: legitimate query within policy -> sign and settle
    console.log('\n--- TEST SCENARIO 1: Legitimate Query ---')
    const req1 = challenge(verifiedMerchant, 1_000_000, '/api/v1/sentiment')
    const res1 = policy.evaluate(req1)
    console.log(`[REQUEST] Payee: ${verifiedMerchant} | Cost: 0.01 HBAR`)
    console.log(`[RESULT]  Approved: ${res1.approved} | Remaining Budget: ${res1.remainingDailyBudget} HBAR`)
    const payment = await signExactPayment(client, req1, agentId, agentKey)
    const settlement = await settleExactPayment(client, payment, operatorKey)
    if (!settlement.success) throw new Error(`Settlement rejected: ${settlement.errorReason}`)
    console.log(`[SUCCESS] Paid and settled: ${getHashscanUrl(settlement.transaction)}`)
    decisions.push({ resource: '/api/v1/sentiment', payTo: verifiedMerchant, hbar: 0.01, decision: 'PAID', tx: settlement.transaction })

    // Scenario 2: price gouging -> rejected before signing
    console.log('\n--- TEST SCENARIO 2: Exorbitant Paywall Attack ---')
    const req2 = challenge(verifiedMerchant, 500_000_000, '/api/v1/private-weights')
    const res2 = policy.evaluate(req2)
    console.log(`[REQUEST] Payee: ${verifiedMerchant} | Cost: 5 HBAR`)
    console.log(`[RESULT]  Approved: ${res2.approved} | Rejection Reason: ${res2.reason}`)
    decisions.push({ resource: '/api/v1/private-weights', payTo: verifiedMerchant, hbar: 5, decision: 'REJECTED', reason: res2.reason.split(':')[0] })

    // Scenario 3: unverified merchant -> rejected before signing
    console.log('\n--- TEST SCENARIO 3: Rogue Merchant Allowlist Check ---')
    const req3 = challenge(rogueMerchant, 1_000_000, '/api/v1/malicious-proxy')
    const res3 = policy.evaluate(req3)
    console.log(`[REQUEST] Payee: ${rogueMerchant} | Cost: 0.01 HBAR`)
    console.log(`[RESULT]  Approved: ${res3.approved} | Rejection Reason: ${res3.reason}`)
    decisions.push({ resource: '/api/v1/malicious-proxy', payTo: rogueMerchant, hbar: 0.01, decision: 'REJECTED', reason: res3.reason.split(':')[0] })

    // 4. Anchor the decisions to an immutable HCS audit log
    console.log('\n[PROCESS] Anchoring the spending decisions to Hedera Consensus Service...')
    const auditTopicId = await reuseTopic('REUSE_M10_05_AUDIT_TOPIC', async () => {
      const topicTx = await new TopicCreateTransaction()
        .setTopicMemo('x402:agent_guardrail_audit')
        .freezeWith(client)
      return (await (await topicTx.execute(client)).getReceipt(client)).topicId
    })
    const auditMessage = JSON.stringify({ agentAccount: agentId, decisions, timestamp: Date.now() })
    const submitResponse = await new TopicMessageSubmitTransaction()
      .setTopicId(auditTopicId)
      .setMessage(auditMessage)
      .execute(client)
    await submitResponse.getReceipt(client)
    console.log(`[SUCCESS] Audit Event Recorded on HCS Topic: ${auditTopicId}`)
    console.log(`[EXPLORER] HashScan: ${getHashscanUrl(submitResponse)}`)

    updateState('X402_AUDIT_TOPIC_ID', auditTopicId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('Only the payment that passed every rule was signed and settled; the other')
    console.log('two never produced a signature. Anchoring the decisions to HCS creates a')
    console.log('tamper-proof record of every HBAR the agent spent or refused to spend.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Guardrail simulation failed:', error.message)
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
