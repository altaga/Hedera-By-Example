/* eslint-disable camelcase, no-unused-vars */

import '@x402/fetch' // Node-only: official x402 client stack

/**
 * ============================================================================
 * Lab 06: Agente de mercado autónomo (bucle completo)
 * [CONCEPT] Agent discovers quotes then pays via official x402
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * The agent compares local quote metadata, then pays the winning official
 * x402-gated Express route with @x402/fetch — no homemade signatures.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Discovery can be simulated; settlement must be the real protocol or the lab
 * is only theater.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Previous: M10 Lab 05: Financial Guardrails
 * - Next:     M10 Lab 07: Live AI Streaming Gateway
 *
 * [ SECUENCIA ]
 * Agent -> Registry: compare quotes (simulated)
 * Agent -> Oracle: GET /api/v1/signals/macro
 * Oracle -> Agent: 402 PAYMENT-REQUIRED
 * Agent -> Oracle: PAYMENT-SIGNATURE via @x402/fetch
 * Oracle -> Agent: 200 + signal + PAYMENT-RESPONSE
 *
 * [ SIMULADO ]
 * Provider catalog/quotes are simulated. The paid HTTP route and settlement are real.
 *
 * [ ANTES DE EJECUTAR ]
 * - OPERATOR_ID pays; MERCHANT_ID receives.
 *
 * [ COMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/06_autonomous_ai_market_agent.js
 * ============================================================================
 */

import {
  createPaidExpressApp,
  listenLocal,
  createPayingFetch,
  decodePaymentResponse,
  getOperatorContext,
  LAB_PRICE_TINYBARS,
  HBAR_ASSET_ID
} from '../M99_Utilities/index.js'
import { updateState } from '../M99_Utilities/storage.js'

const PROVIDERS = [
  { id: 'provider-alpha', name: 'DeepAlpha Quant API', quotedTinybars: 80000n, confidence: 0.94 },
  { id: 'provider-beta', name: 'Apex Hedge Feed', quotedTinybars: 250000n, confidence: 0.98 },
  { id: 'provider-gamma', name: 'OpenSentiment Oracle', quotedTinybars: 75000n, confidence: 0.91 }
]

const main = async () => {
  console.log('--- SESSION START: Autonomous Market Agent (official x402) ---\n')
  const { operatorId, operatorKey, merchantId } = getOperatorContext()
  const budget = 100000n
  const eligible = PROVIDERS.filter((p) => p.quotedTinybars <= budget)
    .map((p) => ({ ...p, utility: p.confidence / Number(p.quotedTinybars) }))
    .sort((a, b) => b.utility - a.utility)
  const winner = eligible[0]
  console.log(`[SUCCESS] Selected ${winner.name} @ ${winner.quotedTinybars} tinybars`)

  const pathName = '/api/v1/signals/macro'
  const { app } = createPaidExpressApp({
    route: `GET ${pathName}`,
    payTo: merchantId,
    price: { amount: winner.quotedTinybars.toString(), asset: HBAR_ASSET_ID },
    description: winner.name,
    handler: (_req, res) => res.json({
      source: winner.name,
      macroIndicator: 'INFLATION_COOLING_EXPANSIONARY',
      marketBias: 'LONG_RISK_ASSETS'
    })
  })
  const { server, baseUrl } = await listenLocal(app)
  try {
    const fetchPaid = createPayingFetch(operatorId.toString(), operatorKey)
    const res = await fetchPaid(`${baseUrl}${pathName}`)
    const settlement = decodePaymentResponse(res)
    console.log(`[SUCCESS] HTTP ${res.status}`)
    console.log('[LOG] PAYMENT-RESPONSE:', JSON.stringify(settlement))
    console.log('[LOG] Intelligence:', await res.text())
    if (res.status !== 200) throw new Error('Agent loop failed to unlock resource')
    updateState('X402_MARKET_AGENT_TX_ID', settlement?.transaction || '')
    updateState('X402_MARKET_AGENT_PROVIDER', winner.name)
    console.log('\n--- SESSION COMPLETE ---')
  } finally {
    server.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => process.exit(0)).catch((e) => { console.error('[FAILED]', e.message); process.exit(1) })
}
