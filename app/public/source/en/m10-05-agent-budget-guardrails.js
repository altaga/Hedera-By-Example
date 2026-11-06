/* eslint-disable camelcase, no-unused-vars */

/**
 * ============================================================================
 * Lab 05: Autonomous Agent Financial Guardrails
 * [CONCEPT] Policy engine over official PaymentRequirements
 * ============================================================================
 * [ KEY CONCEPT ]
 * Guardrails must evaluate the decoded official PaymentRequired.accepts[]
 * fields (network, asset, amount, payTo, feePayer) — not homemade headers.
 *
 * [ LEARNABLE MOMENT ]
 * Spending ceilings, merchant allowlists, and circuit breakers sit in front of
 * @x402/fetch so a runaway agent never creates a PAYMENT-SIGNATURE.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/pay-with-x402
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 04: HTS USDC Micropayments
 * - Next:     M10 Lab 06: Autonomous Market Agent
 *
 * [SEQUENCE]
 * Server -> Agent: 402 PAYMENT-REQUIRED
 * Note Agent: policy.evaluate(accept)
 * Note Agent: reject over-budget / unknown payTo
 * Agent -> Server: only approved accepts get PAYMENT-SIGNATURE
 *
 * [ BEFORE YOU RUN ]
 * - OPERATOR_ID + MERCHANT_ID; one real micropayment if policy approves.
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/05_agent_budget_guardrails.js
 * ============================================================================
 */

import '@x402/fetch' // Node-only: official x402 client stack

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import {
  createPaidExpressApp,
  listenLocal,
  createPayingFetch,
  decodePaymentRequiredHeader,
  decodePaymentResponse,
  getOperatorContext,
  LAB_PRICE_TINYBARS,
  HBAR_ASSET_ID,
  X402_NETWORK
} from '../M99_Utilities/index.js'
import { updateState } from '../M99_Utilities/storage.js'

class AgentPolicyEngine {
  constructor (config) {
    this.maxTinybars = BigInt(config.maxTinybars)
    this.allowedPayees = new Set(config.allowedPayees)
    this.allowedNetworks = new Set(config.allowedNetworks)
    this.circuitBreakerTripped = false
  }

  evaluate (accept) {
    if (this.circuitBreakerTripped) return { approved: false, reason: 'CIRCUIT_BREAKER_ACTIVE' }
    if (!this.allowedNetworks.has(accept.network)) return { approved: false, reason: `NETWORK_DENIED:${accept.network}` }
    if (!this.allowedPayees.has(accept.payTo)) return { approved: false, reason: `UNAUTHORIZED_PAYEE:${accept.payTo}` }
    if (BigInt(accept.amount) > this.maxTinybars) return { approved: false, reason: `CEILING_EXCEEDED:${accept.amount}` }
    return { approved: true }
  }
}

const main = async () => {
  console.log('--- SESSION START: Guardrails on official PaymentRequirements ---\n')
  const { client, operatorId, operatorKey, merchantId } = getOperatorContext()
  const policy = new AgentPolicyEngine({
    maxTinybars: 200000n,
    allowedPayees: [merchantId],
    allowedNetworks: [X402_NETWORK]
  })

  const pathName = '/api/v1/guarded'
  const { app } = createPaidExpressApp({
    route: `GET ${pathName}`,
    payTo: merchantId,
    price: { amount: LAB_PRICE_TINYBARS.challenge, asset: HBAR_ASSET_ID },
    description: 'Guarded resource'
  })
  const { server, baseUrl } = await listenLocal(app)
  try {
    const unpaid = await fetch(`${baseUrl}${pathName}`)
    const required = decodePaymentRequiredHeader(unpaid)
    const accept = required.accepts[0]
    console.log('[LOG] Official accept:', JSON.stringify(accept))

    const rogue = { ...accept, payTo: '0.0.66699', amount: '999999999' }
    console.log('[TEST] Rogue payTo =>', policy.evaluate(rogue))
    console.log('[TEST] Over ceiling =>', policy.evaluate({ ...accept, amount: '999999999' }))
    const ok = policy.evaluate(accept)
    console.log('[TEST] Legitimate accept =>', ok)
    if (!ok.approved) throw new Error(ok.reason)

    const fetchPaid = createPayingFetch(operatorId.toString(), operatorKey)
    const paid = await fetchPaid(`${baseUrl}${pathName}`)
    const settlement = decodePaymentResponse(paid)
    console.log(`[SUCCESS] Paid HTTP ${paid.status}`, settlement)

    const topicTx = await new TopicCreateTransaction().setTopicMemo('x402:official_guardrail_audit').execute(client)
    const topicId = (await topicTx.getReceipt(client)).topicId.toString()
    await (await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify({ action: 'X402_PAYMENT_APPROVED', accept, settlement }))
      .execute(client)).getReceipt(client)
    console.log(`[LOG] Audit topic ${topicId}`)
    updateState('X402_AUDIT_TOPIC_ID', topicId)
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    server.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => process.exit(0)).catch((e) => { console.error('[FAILED]', e.message); process.exit(1) })
}
