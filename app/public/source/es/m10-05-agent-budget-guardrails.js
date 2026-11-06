/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 05: Límites de Gasto para Agentes
 * [CONCEPTO] Un pagador autónomo necesita límites que aplique antes de firmar
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Un agente que paga cualquier 402 que recibe puede quedar vacío por un solo
 * endpoint malicioso, así que necesita límites que aplique antes de firmar.
 *
 * El cliente x402 tiene tres lugares para decir que no, y todos se revisan
 * antes de firmar, así que un pago rechazado nunca sale del agente:
 *   - controles de gasto (spend controls): los activos con los que puede pagar y un
 *     tope por pago;
 *   - políticas: funciones que filtran las ofertas de un 402 (aquí, una lista de
 *     comercios en los que el agente confía);
 *   - hooks: onBeforePaymentCreation puede abortar, aquí cuando se pasaría del
 *     presupuesto de la sesión.
 *
 * Cada decisión se escribe en un tópico de HCS, un registro de auditoría que
 * cualquiera puede leer.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los límites van del lado del comprador. El servidor escribe las condiciones, así
 * que una revisión que confía en el precio o el receptor que dice el servidor no
 * protege nada. Y como el agente solo firma y nunca envía, rechazar no cuesta nada.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402/pay-with-x402
 * - https://www.npmjs.com/package/@x402/core
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 04: Precios en Dólares con una Stablecoin HTS
 * - Siguiente: M10 Lab 06: Un Agente que Compra Datos
 *
 * [ SECUENCIA ]
 * Agente -> Servidor: GET /api/rogue
 * Servidor -> Agente: 402 (payTo no es un comercio de confianza)
 * Nota Agente: la política descarta la oferta, no se firma nada
 * Agente -> Servidor: GET /api/premium
 * Servidor -> Agente: 402 (0.5 ℏ)
 * Nota Agente: el tope por pago es 0.02 ℏ, no se firma nada
 * Agente -> Servidor: GET /api/quote (tres veces)
 * Nota Agente: paga dos veces, el hook de presupuesto frena la tercera
 * Agente -> Hedera: registro de auditoría en un tópico HCS
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el facilitador y paga el mensaje de auditoría.
 * - Wallets de práctica: ACCOUNT_1 es el agente, ACCOUNT_2 el comercio de confianza.
 * - Costo: 0.02 ℏ de ACCOUNT_1 a ACCOUNT_2; unos 0.003 ℏ en comisiones (más 0.01 USD por el tópico de auditoría la primera vez).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/05_agent_budget_guardrails.js
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

// ─── Configuración ────────────────────────────────────────────────────────────
const PORT = 4025
const MAX_PER_PAYMENT = 2_000_000n // 0.02 ℏ
const SESSION_BUDGET = 2_500_000n // 0.025 ℏ

// ─── Principal ─────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- INICIO DE SESIÓN: Límites de Gasto para Agentes ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  if (!agentId || !agentKey || !merchantId) throw new Error('Falta ACCOUNT_1 (agente) o ACCOUNT_2 (comercio). Crea las wallets de práctica o defínelas en .env.')

  let server
  try {
    await ensureFunded(client, agentId, 1)

    // 1. Un servidor con una ruta justa y dos que un agente cuidadoso debería rechazar.
    const { client: facilitator } = createLocalFacilitator(operatorId, operatorKey)
    const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactHederaScheme())
    const offer = (payTo, amount, description) => ({ accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo, price: { amount, asset: HBAR_ASSET_ID } }], description })
    const routes = {
      'GET /api/quote': offer(merchantId, '1000000', 'Cotización (0.01 ℏ)'),
      'GET /api/premium': offer(merchantId, '50000000', 'Reporte premium (0.5 ℏ)'),
      'GET /api/rogue': offer(operatorId, '1000000', 'Paga a alguien con quien el agente nunca acordó')
    }
    const handlers = Object.fromEntries(Object.keys(routes).map((key) => [key, () => ({ route: key, data: 'ok' })]))
    server = http.createServer(paywall(resourceServer, routes, handlers))
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

    // 2. Los límites del agente.
    const trustedMerchants = new Set([merchantId])
    let spent = 0n
    const agent = createBuyer(agentId, agentKey, { maxTinybars: MAX_PER_PAYMENT }) // control de gasto: tope por pago
      // Política: solo quedan las ofertas que pagan a un comercio de la lista.
      .registerPolicy((_version, offers) => offers.filter((o) => trustedMerchants.has(o.payTo)))
      // Hook: rechaza si este pago llevaría la sesión por encima del presupuesto.
      .onBeforePaymentCreation(async ({ selectedRequirements }) => {
        const amount = BigInt(selectedRequirements.amount)
        if (spent + amount > SESSION_BUDGET) return { abort: true, reason: `presupuesto de la sesión: ${formatHbar(spent)} gastados de ${formatHbar(SESSION_BUDGET)}` }
      })
      .onAfterPaymentCreation(async ({ selectedRequirements }) => { spent += BigInt(selectedRequirements.amount) })
    const fetchWithPayment = wrapFetchWithPayment(fetch, agent)

    // 3. Probar cada ruta y anotar qué pasó.
    const decisions = []
    for (const path of ['/api/rogue', '/api/premium', '/api/quote', '/api/quote', '/api/quote']) {
      try {
        const res = await fetchWithPayment(`http://127.0.0.1:${PORT}${path}`)
        const receipt = readPaymentResponse(res)
        decisions.push({ ruta: path, decision: receipt?.success ? 'PAGADO' : `HTTP ${res.status}`, detalle: receipt?.transaction || '' })
        console.log(`[ÉXITO] ${path} → pagado, ${getHashscanUrl(receipt.transaction)}`)
      } catch (error) {
        // El cliente lanzó el error antes de firmar: nada salió del agente.
        const reason = error.message.replace(/^Failed to create payment payload: /, '')
        decisions.push({ ruta: path, decision: 'RECHAZADO', detalle: reason.slice(0, 90) })
        console.log(`[BLOQUEADO] ${path} → ${reason.slice(0, 120)}`)
      }
    }
    show.table(decisions)
    console.log(`[REGISTRO] Gastado en esta sesión: ${formatHbar(spent)} (presupuesto ${formatHbar(SESSION_BUDGET)})`)

    // 4. Registro de auditoría en HCS: un mensaje con todas las decisiones.
    const topicId = await reuseTopic('REUSE_M10_05_AUDIT_TOPIC', async () => {
      const tx = await new TopicCreateTransaction().setTopicMemo('x402 agent spending audit').execute(client)
      return (await tx.getReceipt(client)).topicId
    })
    const audit = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify({ agent: agentId, budget: SESSION_BUDGET.toString(), spent: spent.toString(), decisions: decisions.map(({ ruta, decision }) => ({ path: ruta, decision })) }))
      .execute(client)
    await audit.getReceipt(client)
    console.log(`[REGISTRO] Mensaje de auditoría en el tópico ${topicId}: ${getHashscanUrl(audit)}`)

    const paid = decisions.filter((d) => d.decision === 'PAGADO').length
    if (paid !== 2 || decisions.filter((d) => d.decision === 'RECHAZADO').length !== 3) throw new Error('Los límites no se comportaron como se esperaba')

    console.log('\n CONCEPTO CLAVE:')
    console.log('Tres de cinco peticiones se rechazaron del lado del agente, antes de que')
    console.log('existiera una firma: un receptor no confiable, un precio sobre el tope y un')
    console.log('pago fuera de presupuesto. Las dos llamadas justas se pagaron y todo quedó registrado.')
    console.log('\n--- SESIÓN COMPLETADA ---')
  } finally {
    server?.close()
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLÓ] Error de ejecución:', error.message)
      process.exit(1)
    })
}
