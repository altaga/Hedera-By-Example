/**
 * ============================================================================
 * Lab 06: Agente de Mercado Autónomo (El Ciclo Completo)
 * [CONCEPTO] Descubrir, Comparar, Pagar y Consumir sin un Humano
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Soberanía Económica Extremo a Extremo: La culminación de la Web Agéntica es una
 * IA que encuentra servicios de pago en competencia, lee la cotización x402 de
 * cada uno, compara su relación precio-rendimiento, paga al mejor en Hedera y
 * consume el resultado, todo en segundos, sin humanos, sin cuentas y sin
 * suscripciones con ningún proveedor. Un 402 no cuesta nada, así que pedir el
 * precio a todos es gratis; el dinero se mueve una sola vez, al proveedor elegido.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El HTTP 402 es toda la integración: el agente no necesita API keys ni contratos con ningún proveedor, y el id de transacción de Hedera en PAYMENT-RESPONSE prueba a qué proveedor le pagó y cuánto.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 05: Límites Financieros del Agente Autónomo (Guardrails)
 * - Siguiente: M10 Lab 07: Pasarela Proxy de Streaming de IA (SSE + Liquidación x402)
 *
 * [ SECUENCIA ]
 * Agente -> Proveedores: GET /api/v1/signals/macro (sin pago)
 * Proveedores -> Agente: Cotizaciones 402 (precio, payTo, feePayer)
 * Nota Agente: Elige la mejor confianza por HBAR dentro del presupuesto
 * Agente -> Facilitador: PAYMENT-SIGNATURE para el proveedor elegido
 * Facilitador -> Hedera: Firma y envía
 * Proveedor -> Agente: 200 OK + señal
 *
 * [ SIMULADO ]
 * Los tres proveedores son simulados y todos cobran en ACCOUNT_2. Sus cotizaciones 402 siguen x402, y el pago es real.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el facilitador (paga la comisión de red).
 * - Wallets de práctica: ACCOUNT_1 (agente) paga a ACCOUNT_2 (los proveedores).
 * - Costo: <0.1 ℏ (solo comisiones de red); hasta 0.02 ℏ pasa entre las wallets de práctica.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/06_autonomous_ai_market_agent.js
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
  { id: 'provider-beta', name: 'Apex Hedge Feed', priceTinybars: 9_000_000, latencyMs: 45, confidenceRating: 0.98 }, // fuera de presupuesto
  { id: 'provider-gamma', name: 'OpenSentiment Oracle', priceTinybars: 600_000, latencyMs: 180, confidenceRating: 0.91 }
]
const MAX_PRICE_TINYBARS = 2_000_000 // 0.02 HBAR por petición

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Agente de Mercado Autónomo (El Ciclo Completo) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const providerAccount = process.env.ACCOUNT_2_ID

  if (!agentId || !agentKey || !providerAccount) {
    console.error('[FALLO] Faltan credenciales en .env (ACCOUNT_1 agente, ACCOUNT_2 proveedor).')
    process.exitCode = 1
    return
  }

  try {
    await ensureFunded(client, agentId, 1)
    console.log('[AGENTE] Objetivo: obtener una señal de sentimiento macroeconómico.')
    console.log(`[AGENTE] Política de presupuesto: máximo ${MAX_PRICE_TINYBARS / 1e8} HBAR por petición.\n`)

    // 1. Descubrimiento: cada proveedor responde la petición sin pago con su cotización 402 (gratis)
    console.log('[PROCESO] Pidiendo /api/v1/signals/macro a cada proveedor sin pagar...')
    const quotes = MARKETPLACE_PROVIDERS.map((provider) => ({
      provider,
      paymentRequired: createPaymentRequired({
        resource: '/api/v1/signals/macro',
        description: `Señal macro de ${provider.name}`,
        payTo: providerAccount,
        amount: provider.priceTinybars,
        feePayer: operatorId.toString()
      })
    }))
    console.log(`[REGISTRO] Se recibieron ${quotes.length} cotizaciones HTTP 402. Evaluando:\n`)

    // 2. Comparación: confianza por HBAR, entre las cotizaciones dentro del presupuesto
    const evaluated = quotes.map((q) => {
      const priceHbar = Number(q.paymentRequired.accepts[0].amount) / 1e8
      const withinBudget = Number(q.paymentRequired.accepts[0].amount) <= MAX_PRICE_TINYBARS
      const utilityScore = withinBudget ? q.provider.confidenceRating / priceHbar : 0
      console.log(`- ${q.provider.name}: ${priceHbar} HBAR | Confianza: ${q.provider.confidenceRating} | Dentro del presupuesto: ${withinBudget ? 'SÍ' : 'NO'}`)
      return { ...q, priceHbar, withinBudget, utilityScore }
    })
    const selected = evaluated.filter((e) => e.withinBudget).sort((a, b) => b.utilityScore - a.utilityScore)[0]
    console.log(`\n[ÉXITO] Proveedor óptimo seleccionado: ${selected.provider.name}`)
    console.log(`[REGISTRO] Mejor puntaje: ${selected.utilityScore.toFixed(1)} puntos de confianza por HBAR (Precio: ${selected.priceHbar} HBAR)`)

    // 3. Pagar solo al proveedor elegido: el agente firma, el facilitador liquida
    console.log(`\n[PROCESO] El agente firma el pago para ${selected.provider.name}...`)
    const payment = await signExactPayment(client, selected.paymentRequired, agentId, agentKey)
    console.log('[PROCESO] El facilitador verifica, firma como pagador de la comisión y envía...')
    const settlement = await settleExactPayment(client, payment, operatorKey)
    if (!settlement.success) throw new Error(`Liquidación rechazada: ${settlement.errorReason}`)
    console.log('\n[ÉXITO] Liquidación finalizada en la red:')
    console.log(`[REGISTRO] Estado de consenso: ${settlement.status}`)
    console.log(`[REGISTRO] Id de transacción:  ${settlement.transaction}`)
    console.log(`[EXPLORADOR] HashScan:        ${getHashscanUrl(settlement.transaction)}`)

    // 4. Ingerir la inteligencia desbloqueada
    console.log('\n[PROCESO] El proveedor verificó el PAYMENT-RESPONSE. Ingiriendo la inteligencia desbloqueada...')
    const intelligencePayload = {
      source: selected.provider.name,
      macroIndicator: 'INFLATION_COOLING_EXPANSIONARY',
      marketBias: 'LONG_RISK_ASSETS',
      recommendedHedgeRatio: 0.15,
      paidWith: settlement.transaction
    }
    console.log('[REGISTRO] INTELIGENCIA RECIBIDA:')
    console.log(JSON.stringify(intelligencePayload, null, 2))

    updateState('X402_MARKET_AGENT_TX_ID', settlement.transaction)
    updateState('X402_MARKET_AGENT_PROVIDER', selected.provider.name)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Así se completa el ciclo de la Economía de Máquinas: el agente comparó tres')
    console.log('cotizaciones gratis, pagó un micro-pago en Hedera al mejor proveedor y consumió')
    console.log('el resultado sin que un humano tocara un botón de pago.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la ejecución del agente autónomo:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
