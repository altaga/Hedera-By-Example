/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 05: Spending Guardrails for Agents
 * [CONCEPT] An autonomous payer needs limits it enforces before it signs
 * ============================================================================
 * [ KEY CONCEPT ]
 * An agent that pays any 402 it receives can be drained by one bad endpoint,
 * so it needs limits it enforces before it signs.
 *
 * The x402 client has three places to say no, all checked before anything is
 * signed, so a refused payment never leaves the agent:
 *   - spend controls: the assets it may pay with and a cap per payment;
 *   - policies: functions that filter the offers in a 402 (here, a list of
 *     merchants the agent trusts);
 *   - hooks: onBeforePaymentCreation can abort, here when a session budget
 *     would be exceeded.
 *
 * Every decision is written to an HCS topic, an audit trail anyone can read.
 *
 * [ LEARNABLE MOMENT ]
 * Guardrails belong on the buyer's side. The server writes the terms, so a
 * check that trusts the server's price or payee protects nothing. And because
 * the agent only signs, never submits, refusing costs nothing.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/solutions/ai/x402/pay-with-x402
 * - https://www.npmjs.com/package/@x402/core
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ LEARNING PATH ]
 * - Previous: M10 Lab 04: Pricing in Dollars with an HTS Stablecoin
 * - Next:     M10 Lab 06: An Agent That Shops for Data
 *
 * [ SEQUENCE ]
 * Agent -> Server: GET /api/rogue
 * Server -> Agent: 402 (payTo is not a trusted merchant)
 * Note Agent: policy removes the offer, nothing signed
 * Agent -> Server: GET /api/premium
 * Server -> Agent: 402 (0.5 ℏ)
 * Note Agent: spend control cap is 0.02 ℏ, nothing signed
 * Agent -> Server: GET /api/quote (three times)
 * Note Agent: pays twice, the budget hook stops the third
 * Agent -> Hedera: audit log to an HCS topic
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account is the facilitator and pays the audit message.
 * - Practice wallets: ACCOUNT_1 is the agent, ACCOUNT_2 the trusted merchant.
 * - Cost: 0.02 ℏ from ACCOUNT_1 to ACCOUNT_2; about 0.003 ℏ in fees (plus 0.01 USD for the audit topic on the first run).
 *
 * [ HOW TO RUN ]
 * node English/M10_Agentic_Micropayments_x402/05_agent_budget_guardrails.js
 * ============================================================================
 */

import http from 'node:http'
import { TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { x402ResourceServer } from '@x402/core/server'
import { wrapFetchWithPayment } from '@x402/fetch'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HBAR_ASSET_ID } from '@x402/hedera'
import {
  getClient,
  getHashscanUrl,
  ensureFunded,
  reuseTopic,
  show,
  X402_NETWORK,
  createBuyer,
  createLocalFacilitator,
  paywall,
  readPaymentResponse,
  formatHbar
} from '../M99_Utilities/index.js'

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = 4025
const MAX_PER_PAYMENT = 2_000_000n // 0.02 ℏ
const SESSION_BUDGET = 2_500_000n // 0.025 ℏ

// ─── Main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- SESSION START: Spending Guardrails for Agents ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  if (!agentId || !agentKey || !merchantId) throw new Error('Missing ACCOUNT_1 (agent) or ACCOUNT_2 (merchant). Create practice wallets or set them in .env.')

  let server
  try {
    await ensureFunded(client, agentId, 1)

    // 1. A server with one fair route and two that a careful agent should refuse.
    const { client: facilitator } = createLocalFacilitator(operatorId, operatorKey)
    const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactHederaScheme())
    const offer = (payTo, amount, description) => ({ accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo, price: { amount, asset: HBAR_ASSET_ID } }], description })
    const routes = {
      'GET /api/quote': offer(merchantId, '1000000', 'Price quote (0.01 ℏ)'),
      'GET /api/premium': offer(merchantId, '50000000', 'Premium report (0.5 ℏ)'),
      'GET /api/rogue': offer(operatorId, '1000000', 'Pays someone the agent never agreed to')
    }
    const handlers = Object.fromEntries(Object.keys(routes).map((key) => [key, () => ({ route: key, data: 'ok' })]))
    server = http.createServer(paywall(resourceServer, routes, handlers))
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

    // 2. The agent's guardrails.
    const trustedMerchants = new Set([merchantId])
    let spent = 0n
    const agent = createBuyer(agentId, agentKey, { maxTinybars: MAX_PER_PAYMENT }) // spend control: cap per payment
      // Policy: keep only offers that pay a merchant on the allowlist.
      .registerPolicy((_version, offers) => offers.filter((o) => trustedMerchants.has(o.payTo)))
      // Hook: refuse when this payment would take the session over budget.
      .onBeforePaymentCreation(async ({ selectedRequirements }) => {
        const amount = BigInt(selectedRequirements.amount)
        if (spent + amount > SESSION_BUDGET) return { abort: true, reason: `session budget: ${formatHbar(spent)} spent of ${formatHbar(SESSION_BUDGET)}` }
      })
      .onAfterPaymentCreation(async ({ selectedRequirements }) => { spent += BigInt(selectedRequirements.amount) })
    const fetchWithPayment = wrapFetchWithPayment(fetch, agent)

    // 3. Try every route and record what happened.
    const decisions = []
    for (const path of ['/api/rogue', '/api/premium', '/api/quote', '/api/quote', '/api/quote']) {
      try {
        const res = await fetchWithPayment(`http://127.0.0.1:${PORT}${path}`)
        const receipt = readPaymentResponse(res)
        decisions.push({ path, decision: receipt?.success ? 'PAID' : `HTTP ${res.status}`, detail: receipt?.transaction || '' })
        console.log(`[SUCCESS] ${path} → paid, ${getHashscanUrl(receipt.transaction)}`)
      } catch (error) {
        // The client threw before signing: nothing left the agent.
        const reason = error.message.replace(/^Failed to create payment payload: /, '')
        decisions.push({ path, decision: 'REFUSED', detail: reason.slice(0, 90) })
        console.log(`[BLOCKED] ${path} → ${reason.slice(0, 120)}`)
      }
    }
    show.table(decisions)
    console.log(`[LOG] Spent this session: ${formatHbar(spent)} (budget ${formatHbar(SESSION_BUDGET)})`)

    // 4. Audit trail on HCS: one message with every decision.
    const topicId = await reuseTopic('REUSE_M10_05_AUDIT_TOPIC', async () => {
      const tx = await new TopicCreateTransaction().setTopicMemo('x402 agent spending audit').execute(client)
      return (await tx.getReceipt(client)).topicId
    })
    const audit = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify({ agent: agentId, budget: SESSION_BUDGET.toString(), spent: spent.toString(), decisions: decisions.map(({ path, decision }) => ({ path, decision })) }))
      .execute(client)
    await audit.getReceipt(client)
    console.log(`[LOG] Audit message on topic ${topicId}: ${getHashscanUrl(audit)}`)

    const paid = decisions.filter((d) => d.decision === 'PAID').length
    if (paid !== 2 || decisions.filter((d) => d.decision === 'REFUSED').length !== 3) throw new Error('Guardrails did not behave as expected')

    console.log('\n KEY CONCEPT:')
    console.log('Three of five requests were refused on the agent side, before any')
    console.log('signature existed: an untrusted payee, a price over the cap and a')
    console.log('payment over budget. The two fair calls were paid and everything was logged.')
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    server?.close()
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
