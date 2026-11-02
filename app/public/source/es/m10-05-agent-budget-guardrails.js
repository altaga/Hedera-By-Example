/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Límites Financieros del Agente Autónomo (Guardrails)
 * [ CONCEPTO ] Motores de Políticas, Techos de Gasto y Disyuntores
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Radio de Impacto Financiero: Darle llaves privadas a un agente de IA sin límites
 * programáticos es catastrófico: un bucle recursivo del LLM o un ataque de inyección
 * de prompts podría vaciar miles de dólares en minutos. Un agente en producción
 * debe evaluar cada desafío x402 a través de un Motor de Políticas determinista
 * que imponga topes diarios, techos por petición y listas blancas de comercios
 * antes de generar cualquier firma criptográfica.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Nunca des a un agente autónomo una billetera sin límites. Aplicar topes diarios de gasto, listas blancas de comerciantes y circuit breakers evita espirales incontroladas de costo de inferencia.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/approve-an-allowance
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M10 Lab 04: Micropagos USDC en HTS
 * - Actual:   M10 Lab 05: Límites Financieros (Guardrails)
 * - Siguiente: M10 Lab 06: Agente de Mercado Autónomo
 *
 * [ SECUENCIA ]
 * Servidor -> Agente: Solicitud 1: 0.5 ℏ a un comercio verificado
 * Nota Agente: Aprobada (dentro del presupuesto y la lista permitida)
 * Servidor -> Agente: Solicitud 2: 12 ℏ
 * Nota Agente: Rechazada: supera 1.5 ℏ por solicitud
 * Servidor -> Agente: Solicitud 3: comercio desconocido
 * Nota Agente: Rechazada: no está en la lista permitida
 * Agente -> Hedera: Auditar el pago aprobado en HCS
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/05_agent_budget_guardrails.js
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
      return { approved: false, reason: 'DISYUNTOR_ACTIVO: La billetera del agente está en pausa de emergencia.' }
    }

    if (!this.merchantAllowlist.has(payee)) {
      return { approved: false, reason: `COMERCIO_NO_AUTORIZADO: El comercio ${payee} no está en la lista blanca verificada.` }
    }

    if (amountHbar > this.maxPerRequestHbar) {
      return { approved: false, reason: `TECHO_EXCEDIDO: Los ${amountHbar} HBAR solicitados superan el límite de ${this.maxPerRequestHbar} HBAR.` }
    }

    if (this.currentDailySpend + amountHbar > this.dailyLimitHbar) {
      return { approved: false, reason: `PRESUPUESTO_AGOTADO: Se superaría el límite acumulativo diario de ${this.dailyLimitHbar} HBAR.` }
    }

    // Aprobar y actualizar estado
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
    return `ALERTA DE EMERGENCIA: Disyuntor activado. Motivo: ${reason}`
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Límites Financieros del Agente Autónomo ---\n')
  const { client, operatorId, network } = getClient()

  try {
    const verifiedMerchantA = operatorId.toString()
    const verifiedMerchantB = '0.0.98765'
    const rogueMerchant = '0.0.66699'

    console.log('[⚙️ PROCESO] Inicializando Motor de Políticas Determinista del Agente...')
    const policy = new AgentPolicyEngine({
      dailyLimitHbar: 5.0,
      maxPerRequestHbar: 1.5,
      allowedMerchants: [verifiedMerchantA, verifiedMerchantB]
    })

    console.log('[📊 REGISTRO] Límite Diario:              5.0 HBAR')
    console.log('[📊 REGISTRO] Costo Máximo por Petición:  1.5 HBAR')
    console.log(`[📊 REGISTRO] Comercios Verificados:      ${verifiedMerchantA}, ${verifiedMerchantB}`)

    // Escenario 1: Petición legítima dentro de la política
    console.log('\n--- ESCENARIO 1: Petición Legítima ---')
    const req1 = { payee: verifiedMerchantA, amountHbar: 0.5, resource: '/api/v1/sentiment' }
    const res1 = policy.evaluate(req1)
    console.log(`[PETICIÓN] Comercio: ${req1.payee} | Costo: ${req1.amountHbar} HBAR`)
    console.log(`[RESULTADO] Aprobado: ${res1.approved} | Presupuesto Restante: ${res1.remainingDailyBudget} HBAR`)

    // Escenario 2: Intento de cobro abusivo
    console.log('\n--- ESCENARIO 2: Ataque de Paywall Exorbitante ---')
    const req2 = { payee: verifiedMerchantB, amountHbar: 12.0, resource: '/api/v1/private-weights' }
    const res2 = policy.evaluate(req2)
    console.log(`[PETICIÓN] Comercio: ${req2.payee} | Costo: ${req2.amountHbar} HBAR`)
    console.log(`[RESULTADO] Aprobado: ${res2.approved} | Motivo de Rechazo: ${res2.reason}`)

    // Escenario 3: Comercio no verificado / phishing
    console.log('\n--- ESCENARIO 3: Control de Lista Blanca de Comercios ---')
    const req3 = { payee: rogueMerchant, amountHbar: 0.2, resource: '/api/v1/malicious-proxy' }
    const res3 = policy.evaluate(req3)
    console.log(`[PETICIÓN] Comercio: ${req3.payee} | Costo: ${req3.amountHbar} HBAR`)
    console.log(`[RESULTADO] Aprobado: ${res3.approved} | Motivo de Rechazo: ${res3.reason}`)

    // 4. Anclar auditoría de gasto a un Tópico Inmutable de HCS
    console.log('\n[⚙️ PROCESO] Anclando evento de auditoría de pago a Hedera Consensus Service...')
    // Crea el tópico: un registro de mensajes ordenado y con timestamp; una submit key restringiría quién escribe.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('x402:agent_guardrail_audit')
      .freezeWith(client)
    const topicResponse = await topicTx.execute(client)
    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const topicReceipt = await topicResponse.getReceipt(client)
    const auditTopicId = topicReceipt.topicId.toString()

    const auditMessage = JSON.stringify({
      agentAccount: operatorId.toString(),
      action: 'X402_PAYMENT_APPROVED',
      amountHbar: req1.amountHbar,
      payee: req1.payee,
      timestamp: Date.now()
    })

    // Publica: el consenso le da al mensaje un número de secuencia y un timestamp en el que todos coinciden.
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(auditTopicId)
      .setMessage(auditMessage)
      .freezeWith(client)
    const submitResponse = await submitTx.execute(client)
    const submitReceipt = await submitResponse.getReceipt(client)

    console.log(`[✅ ÉXITO] Evento de Auditoría Registrado en Tópico HCS: ${auditTopicId}`)
    console.log(`[📊 REGISTRO] Mensaje de Auditoría: ${auditMessage}`)

    updateState('X402_AUDIT_TOPIC_ID', auditTopicId)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('La identidad descentralizada y las políticas de gasto protegen al titular humano')
    console.log('de contingencias financieras. Anclar las auditorías a HCS genera un registro')
    console.log('irrefutable e inmutable de cada centavo gastado por agentes autónomos.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Fallo en la simulación de límites financieros:', error.message)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
