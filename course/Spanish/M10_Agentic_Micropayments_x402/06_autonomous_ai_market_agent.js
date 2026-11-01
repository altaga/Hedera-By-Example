/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Agente de Mercado Autónomo (El Ciclo Completo)
 * [ CONCEPTO CLAVE ] Descubrimiento, Evaluación y Liquidación Autónoma
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Soberanía Económica Extremo a Extremo: La culminación de la Web Agéntica es una IA
 * que descubre múltiples servicios de pago en competencia, compara su relación
 * precio-rendimiento, negocia el acceso, liquida el pago de forma autónoma en
 * Hedera mediante x402 e ingiere la inteligencia resultante, todo en segundos y sin
 * fricción ni intervención humana.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El ciclo completo de la economía autónoma: un agente de IA descubre un endpoint de datos de pago, evalúa su rentabilidad, firma el pago x402, liquida en Hedera y consume la inteligencia sin intervención humana.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hashgraph.com/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M10 Lab 05: Límites Financieros (Guardrails)
 * - Actual:   M10 Lab 06: Agente de Mercado Autónomo
 * - Siguiente: M10 Lab 07: Pasarela Proxy de Streaming de IA
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/06_autonomous_ai_market_agent.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  TransferTransaction,
  Hbar,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

// Simulación de 3 proveedores de inteligencia en competencia
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
    quotedPriceHbar: 2.5, // Supera el techo de presupuesto
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
  console.log('--- INICIO DEL LABORATORIO: Agente de Mercado Autónomo (El Ciclo Completo) ---\n')
  const { client, operatorId, operatorKey, network } = getClient()

  try {
    console.log('[🤖 AGENTE] Objetivo: Adquirir señal de sentimiento macroeconómico de mercado.')
    console.log('[🤖 AGENTE] Política de Gasto: Máximo 1.0 HBAR por consulta.\n')

    // 1. Descubrimiento y Comparación de Servicios
    console.log('[⚙️ PROCESO] Escaneando registro descentralizado de proveedores elegibles...')
    console.log(`[📊 REGISTRO] ${MARKETPLACE_PROVIDERS.length} proveedores encontrados. Evaluando cotizaciones:\n`)

    const evaluatedProviders = MARKETPLACE_PROVIDERS.map((provider) => {
      const withinBudget = provider.quotedPriceHbar <= 1.0
      // Calcular puntaje de utilidad: confianza / precio
      const utilityScore = withinBudget ? (provider.confidenceRating / provider.quotedPriceHbar) : 0
      console.log(`- ${provider.name}: ${provider.quotedPriceHbar} HBAR | Confianza: ${provider.confidenceRating} | En Presupuesto: ${withinBudget ? 'SÍ' : 'NO'}`)
      return { ...provider, withinBudget, utilityScore }
    })

    // Filtrar y seleccionar el proveedor con mejor relación utilidad/precio
    const eligibleProviders = evaluatedProviders.filter(p => p.withinBudget)
    eligibleProviders.sort((a, b) => b.utilityScore - a.utilityScore)
    const selectedProvider = eligibleProviders[0]

    console.log(`\n[✅ ÉXITO] Proveedor Óptimo Seleccionado: ${selectedProvider.name}`)
    console.log(`[📊 REGISTRO] Mejor Puntaje de Utilidad: ${selectedProvider.utilityScore.toFixed(3)} (Precio: ${selectedProvider.quotedPriceHbar} HBAR)`)

    // 2. Solicitar Recurso y Recibir Desafío HTTP 402
    console.log(`\n[⚙️ PROCESO] Enviando petición no autenticada a ${selectedProvider.name}...`)
    const challengeNonce = crypto.randomBytes(16).toString('hex')
    console.log(`[📊 REGISTRO] Servidor respondió: HTTP 402 Payment Required (Nonce: ${challengeNonce})`)

    // 3. Firma Criptográfica Autónoma
    console.log('\n[⚙️ PROCESO] Agente generando firma criptográfica de pago...')
    const signerKey = PrivateKey.fromStringDer(operatorKey)
    const paymentIntent = {
      payer: operatorId.toString(),
      payee: operatorId.toString(), // Simulación de auto-transferencia en testnet
      amount: selectedProvider.quotedPriceHbar,
      asset: 'HBAR',
      nonce: challengeNonce,
      timestamp: Date.now()
    }

    const serialized = JSON.stringify(paymentIntent)
    const signatureBytes = signerKey.sign(Buffer.from(serialized, 'utf8'))
    const signatureHex = Buffer.from(signatureBytes).toString('hex')
    console.log(`[✅ ÉXITO] Firma generada: ${signatureHex.substring(0, 32)}...`)

    // 4. Facilitador con Cero Gas Transmitiendo y Liquidando en Hedera
    console.log('\n[⚙️ PROCESO] Transmitiendo pago a la red Hedera para liquidación por consenso...')
    const transferTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-selectedProvider.quotedPriceHbar))
      .addHbarTransfer(operatorId, new Hbar(selectedProvider.quotedPriceHbar))
      .setTransactionMemo(`x402:agent_loop:${selectedProvider.id}`)
      .freezeWith(client)

    const txResponse = await transferTx.execute(client)
    const receipt = await txResponse.getReceipt(client)
    const hashscanUrl = getHashscanUrl(txResponse)

    console.log('\n[✅ ÉXITO] Liquidación On-Chain Finalizada:')
    console.log(`[📊 REGISTRO] Estado de Consenso: ${receipt.status.toString()}`)
    console.log(`[📊 REGISTRO] ID de Transacción:  ${txResponse.transactionId.toString()}`)
    console.log(`[🔗 EXPLORADOR] HashScan:         ${hashscanUrl}`)

    // 5. Ingerir Inteligencia Desbloqueada
    console.log('\n[⚙️ PROCESO] Servidor verificó prueba de pago. Ingestionando payload de datos desbloqueado...')
    const intelligencePayload = {
      source: selectedProvider.name,
      macroIndicator: 'INFLATION_COOLING_EXPANSIONARY',
      marketBias: 'LONG_RISK_ASSETS',
      recommendedHedgeRatio: 0.15,
      timestamp: new Date().toISOString()
    }

    console.log('\n[📊 REGISTRO] PAYLOAD DE INTELIGENCIA RECIBIDO:')
    console.dir(intelligencePayload, { depth: null })

    updateState('X402_MARKET_AGENT_TX_ID', txResponse.transactionId.toString())
    updateState('X402_MARKET_AGENT_PROVIDER', selectedProvider.name)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Esto completa la visión de la Economía de Máquinas: agentes de IA que')
    console.log('descubren servicios, evalúan alternativas, pagan micro-liquidaciones on-chain')
    console.log('a través de Hedera, y entregan inteligencia de alto nivel sin intervención humana.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Fallo en la ejecución del agente autónomo:', error.message)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ FALLO] Error de Ejecución:', error.message)
    process.exit(1)
  })
}
