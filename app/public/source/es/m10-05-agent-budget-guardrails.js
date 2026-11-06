/**
 * ============================================================================
 * Lab 05: Límites Financieros del Agente Autónomo (Guardrails)
 * [CONCEPTO] Políticas de Gasto Deterministas y Registros de Auditoría Inmutables
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Radio de Impacto Financiero: Darle llaves privadas a un agente autónomo sin
 * límites programáticos es catastrófico: un bucle recursivo del LLM o una
 * inyección de prompts podría vaciar la wallet en minutos. Un agente en producción
 * evalúa cada desafío x402 con un Motor de Políticas determinista (techo por
 * petición, presupuesto diario, lista blanca de comercios, red y activo
 * aceptados) antes de firmar nada. Un 402 rechazado nunca produce una firma, así
 * que no hay nada que liquidar.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los límites son del pagador, no del servidor: el servidor escribe las condiciones, así que el agente debe revisarlas por sí mismo. Anclar cada decisión en HCS le da al dueño humano un registro a prueba de manipulaciones de lo que el agente pagó y de lo que rechazó.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402/pay-with-x402
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 04: Micropagos en Stablecoins (USDC) con HTS
 * - Siguiente: M10 Lab 06: Agente de Mercado Autónomo (El Ciclo Completo)
 *
 * [ SECUENCIA ]
 * Servidor -> Agente: 402 (0.01 ℏ, comercio verificado)
 * Nota Agente: La política aprueba, firma y el facilitador liquida
 * Servidor -> Agente: 402 (5 ℏ, comercio verificado)
 * Nota Agente: La política rechaza: techo superado, no se firma nada
 * Servidor -> Agente: 402 (0.01 ℏ, comercio desconocido)
 * Nota Agente: La política rechaza: el receptor no está en la lista blanca
 * Agente -> Hedera: Registro de auditoría de las tres decisiones en HCS
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el facilitador y paga el registro de auditoría.
 * - Wallets de práctica: ACCOUNT_1 (agente) paga a ACCOUNT_2 (comercio verificado).
 * - Costo: <0.1 ℏ (comisiones de red; el tópico de auditoría se crea una vez y se reutiliza); 0.01 ℏ pasa entre las wallets de práctica.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/05_agent_budget_guardrails.js
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

  // Revisa las condiciones decodificadas de PAYMENT-REQUIRED antes de firmar nada.
  evaluate (paymentRequired) {
    const { payTo, amount, network, asset } = paymentRequired.accepts[0]
    const tinybars = Number(amount)

    if (network !== 'hedera:testnet' || asset !== '0.0.0') {
      return { approved: false, reason: `UNSUPPORTED_ASSET: ${asset} en ${network}` }
    }
    if (!this.merchantAllowlist.has(payTo)) {
      return { approved: false, reason: `UNAUTHORIZED_PAYEE: el comercio ${payTo} no está en la lista blanca verificada.` }
    }
    if (tinybars > this.maxPerRequestTinybars) {
      return { approved: false, reason: `CEILING_EXCEEDED: ${tinybars / 1e8} HBAR supera el límite de ${this.maxPerRequestTinybars / 1e8} HBAR por petición.` }
    }
    if (this.currentDailySpend + tinybars > this.dailyLimitTinybars) {
      return { approved: false, reason: `BUDGET_DEPLETED: se superaría el límite diario de ${this.dailyLimitTinybars / 1e8} HBAR.` }
    }

    this.currentDailySpend += tinybars
    return { approved: true, remainingDailyBudget: (this.dailyLimitTinybars - this.currentDailySpend) / 1e8 }
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Límites Financieros del Agente Autónomo ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const verifiedMerchant = process.env.ACCOUNT_2_ID
  const rogueMerchant = '0.0.66699' // una cuenta a la que el agente nunca aceptó pagar

  if (!agentId || !agentKey || !verifiedMerchant) {
    console.error('[FALLO] Faltan credenciales en .env (ACCOUNT_1 agente, ACCOUNT_2 comercio).')
    process.exitCode = 1
    return
  }

  try {
    await ensureFunded(client, agentId, 1)

    console.log('[PROCESO] Inicializando el Motor de Políticas determinista del agente...')
    const policy = new AgentPolicyEngine({
      dailyLimitTinybars: 5_000_000, // 0.05 HBAR por día
      maxPerRequestTinybars: 2_000_000, // 0.02 HBAR por petición
      allowedMerchants: [verifiedMerchant]
    })
    console.log('[REGISTRO] Presupuesto diario:      0.05 HBAR')
    console.log('[REGISTRO] Costo máximo por petición: 0.02 HBAR')
    console.log(`[REGISTRO] Comercios verificados:   ${verifiedMerchant}`)

    const challenge = (payTo, tinybars, resource) => createPaymentRequired({ resource, description: resource, payTo, amount: tinybars, feePayer: operatorId.toString() })
    const decisions = []

    // Escenario 1: consulta legítima dentro de la política -> firmar y liquidar
    console.log('\n--- ESCENARIO 1: Consulta Legítima ---')
    const req1 = challenge(verifiedMerchant, 1_000_000, '/api/v1/sentiment')
    const res1 = policy.evaluate(req1)
    console.log(`[PETICIÓN]  Receptor: ${verifiedMerchant} | Costo: 0.01 HBAR`)
    console.log(`[RESULTADO] Aprobado: ${res1.approved} | Presupuesto restante: ${res1.remainingDailyBudget} HBAR`)
    const payment = await signExactPayment(client, req1, agentId, agentKey)
    const settlement = await settleExactPayment(client, payment, operatorKey)
    if (!settlement.success) throw new Error(`Liquidación rechazada: ${settlement.errorReason}`)
    console.log(`[ÉXITO] Pagado y liquidado: ${getHashscanUrl(settlement.transaction)}`)
    decisions.push({ resource: '/api/v1/sentiment', payTo: verifiedMerchant, hbar: 0.01, decision: 'PAID', tx: settlement.transaction })

    // Escenario 2: precio abusivo -> rechazado antes de firmar
    console.log('\n--- ESCENARIO 2: Ataque de Paywall Abusivo ---')
    const req2 = challenge(verifiedMerchant, 500_000_000, '/api/v1/private-weights')
    const res2 = policy.evaluate(req2)
    console.log(`[PETICIÓN]  Receptor: ${verifiedMerchant} | Costo: 5 HBAR`)
    console.log(`[RESULTADO] Aprobado: ${res2.approved} | Motivo del rechazo: ${res2.reason}`)
    decisions.push({ resource: '/api/v1/private-weights', payTo: verifiedMerchant, hbar: 5, decision: 'REJECTED', reason: res2.reason.split(':')[0] })

    // Escenario 3: comercio no verificado -> rechazado antes de firmar
    console.log('\n--- ESCENARIO 3: Comercio Fraudulento fuera de la Lista Blanca ---')
    const req3 = challenge(rogueMerchant, 1_000_000, '/api/v1/malicious-proxy')
    const res3 = policy.evaluate(req3)
    console.log(`[PETICIÓN]  Receptor: ${rogueMerchant} | Costo: 0.01 HBAR`)
    console.log(`[RESULTADO] Aprobado: ${res3.approved} | Motivo del rechazo: ${res3.reason}`)
    decisions.push({ resource: '/api/v1/malicious-proxy', payTo: rogueMerchant, hbar: 0.01, decision: 'REJECTED', reason: res3.reason.split(':')[0] })

    // 4. Anclar las decisiones en un registro de auditoría inmutable en HCS
    console.log('\n[PROCESO] Anclando las decisiones de gasto en Hedera Consensus Service...')
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
    console.log(`[ÉXITO] Evento de auditoría registrado en el tópico HCS: ${auditTopicId}`)
    console.log(`[EXPLORADOR] HashScan: ${getHashscanUrl(submitResponse)}`)

    updateState('X402_AUDIT_TOPIC_ID', auditTopicId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Solo el pago que cumplió todas las reglas se firmó y liquidó; los otros dos')
    console.log('nunca produjeron una firma. Anclar las decisiones en HCS crea un registro a')
    console.log('prueba de manipulaciones de cada HBAR que el agente gastó o se negó a gastar.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la simulación de límites:', error.message)
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
