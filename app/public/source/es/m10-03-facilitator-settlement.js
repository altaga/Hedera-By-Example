/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 03: El Facilitador Liquida en Hedera
 * [CONCEPTO] Verificar, entregar, liquidar: el ciclo x402 completo con una transferencia real
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Este lab hace una compra x402 completa por HTTP y la liquida con una
 * transferencia real en Hedera testnet.
 *
 * Paso a paso:
 *   1. GET sin pago                   → 402 + PAYMENT-REQUIRED
 *   2. GET con PAYMENT-SIGNATURE      → el servidor pide al facilitador que verifique
 *   3. el servidor hace el trabajo    (corre el handler de la ruta)
 *   4. el facilitador liquida         → agrega su firma como quien paga la
 *                                       comisión y envía la transferencia a Hedera
 *   5. 200 + PAYMENT-RESPONSE         → el id de la transacción de Hedera, como recibo
 *
 * El dinero va directo del agente al comercio en una sola transferencia de Hedera:
 * sin custodia, sin contrato inteligente, con finalidad en unos segundos.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Quién paga qué: el saldo del agente baja exactamente el precio; la comisión de red
 * se cobra al facilitador, porque el id de la transacción es su cuenta. Repetir el
 * pago es imposible por diseño: un id de transacción de Hedera solo se ejecuta una
 * vez, así que reenviar la misma PAYMENT-SIGNATURE falla con DUPLICATE_TRANSACTION.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402/how-it-works
 * - https://docs.hedera.com/solutions/ai/x402/facilitators
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 02: El Agente Firma un Pago
 * - Siguiente: M10 Lab 04: Precios en Dólares con una Stablecoin HTS
 *
 * [ SECUENCIA ]
 * Agente -> Servidor: GET /api/forecast
 * Servidor -> Agente: 402 + PAYMENT-REQUIRED
 * Agente -> Servidor: GET /api/forecast + PAYMENT-SIGNATURE
 * Servidor -> Facilitador: verify
 * Nota Servidor: corre el handler de pago
 * Servidor -> Facilitador: settle
 * Facilitador -> Hedera: TransferTransaction firmada por el agente + quien paga la comisión
 * Hedera -> Facilitador: recibo SUCCESS
 * Servidor -> Agente: 200 + PAYMENT-RESPONSE (id de transacción)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el facilitador y paga la comisión de red.
 * - Wallets de práctica: ACCOUNT_1 es el agente (paga el precio), ACCOUNT_2 el comercio.
 * - Costo: 0.01 ℏ pasan de ACCOUNT_1 a ACCOUNT_2; tú pagas unos 0.003 ℏ de comisiones.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/03_facilitator_settlement.js
 * ============================================================================
 */

import http from 'node:http'
import { x402ResourceServer } from '@x402/core/server'
import { encodePaymentSignatureHeader } from '@x402/core/http'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HBAR_ASSET_ID } from '@x402/hedera'
import {
  getClient,
  getHashscanUrl,
  getMirrorNodeBaseUrl,
  waitForMirror,
  ensureFunded,
  updateState,
  show,
  X402_NETWORK,
  createBuyer,
  createLocalFacilitator,
  paywall,
  readPaymentRequired,
  readPaymentResponse,
  formatHbar
} from '../M99_Utilities/index.js'

// ─── Configuración ────────────────────────────────────────────────────────────
const PORT = 4023
const ROUTE = '/api/forecast'
const PRICE_TINYBARS = '1000000' // 0.01 ℏ

// ─── Principal ─────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- INICIO DE SESIÓN: El Facilitador Liquida en Hedera ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  if (!agentId || !agentKey || !merchantId) throw new Error('Falta ACCOUNT_1 (agente) o ACCOUNT_2 (comercio). Crea las wallets de práctica o defínelas en .env.')

  let server
  try {
    // El agente necesita el precio en su cuenta (no gas). Se recarga si está casi vacía.
    await ensureFunded(client, agentId, 1)

    // 1. Comercio y facilitador. Los hooks muestran lo que hace el servidor en cada petición.
    const { client: facilitator, feePayer } = createLocalFacilitator(operatorId, operatorKey)
    const resourceServer = new x402ResourceServer(facilitator)
      .register(X402_NETWORK, new ExactHederaScheme())
      .onAfterVerify(async ({ result }) => console.log(`  [SERVIDOR] verify del facilitador → isValid: ${result.isValid}`))
      .onAfterSettle(async ({ result }) => console.log(`  [SERVIDOR] settle del facilitador → ${result.success ? result.transaction : result.errorReason}`))
      .onSettleFailure(async ({ error }) => console.log(`  [SERVIDOR] settle falló → ${error?.message || error}`))
    const routes = {
      [`GET ${ROUTE}`]: {
        accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: { amount: PRICE_TINYBARS, asset: HBAR_ASSET_ID } }],
        description: 'Pronóstico de volatilidad de HBAR a seis horas'
      }
    }
    const handlers = {
      [`GET ${ROUTE}`]: () => {
        console.log('  [SERVIDOR] pago verificado → corre el handler de pago')
        return { horizon: '6h', volatility: 0.042, signal: 'RANGE_BOUND' }
      }
    }
    server = http.createServer(paywall(resourceServer, routes, handlers))
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${PORT}${ROUTE}`

    // 2. Primera petición: sin pago, así que el servidor responde 402 con sus condiciones.
    console.log(`[PROCESO] Agente: GET ${ROUTE}`)
    const unpaid = await fetch(url)
    const challenge = readPaymentRequired(unpaid)
    console.log(`[REGISTRO] HTTP ${unpaid.status}: ${formatHbar(challenge.accepts[0].amount)} a ${merchantId}`)

    // 3. El agente firma (Lab 02) y reintenta con el pago en PAYMENT-SIGNATURE.
    const agent = createBuyer(agentId, agentKey, { maxTinybars: 5_000_000 })
    const payment = await agent.createPaymentPayload(challenge)
    const paymentHeader = encodePaymentSignatureHeader(payment)
    console.log(`\n[PROCESO] Agente: GET ${ROUTE} con PAYMENT-SIGNATURE`)
    const paid = await fetch(url, { headers: { 'PAYMENT-SIGNATURE': paymentHeader } })
    const body = await paid.json()
    const receipt = readPaymentResponse(paid)
    console.log(`[ÉXITO] HTTP ${paid.status}, cuerpo: ${JSON.stringify(body)}`)
    console.log('[REGISTRO] PAYMENT-RESPONSE:')
    show.json(receipt)
    if (paid.status !== 200 || !receipt?.success) throw new Error(`El pago no se liquidó: ${receipt?.errorReason || paid.status}`)
    console.log(`[REGISTRO] Ver en HashScan: ${getHashscanUrl(receipt.transaction)}`)

    // 4. Preguntar al Mirror Node quién pagó qué en esa transacción.
    const mirrorId = receipt.transaction.replace('@', '-').replace(/\.(\d+)$/, '-$1')
    const record = await waitForMirror(async () => {
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/transactions/${mirrorId}`)
      return res.ok ? (await res.json()).transactions?.[0] : null
    })
    if (record) {
      // Cambio neto de HBAR por cuenta. Se excluyen las recompensas de staking que Hedera paga en la misma transacción.
      const sum = (list, id) => (list || []).filter((t) => t.account === id).reduce((total, t) => total + t.amount, 0)
      const net = (id) => sum(record.transfers, id) - sum(record.staking_reward_transfers, id)
      console.log(`\n[REGISTRO] Mirror Node: ${record.result}, comisión de ${formatHbar(record.charged_tx_fee)} cobrada a ${record.transaction_id.split('-')[0]}`)
      show.table([
        { papel: 'agente (comprador)', cuenta: agentId, cambio: formatHbar(net(agentId)) },
        { papel: 'comercio (payTo)', cuenta: merchantId, cambio: formatHbar(net(merchantId)) },
        { papel: 'facilitador (paga la comisión)', cuenta: feePayer, cambio: formatHbar(net(feePayer)) }
      ])
    }

    // 5. Repetición: se envía exactamente el mismo pago otra vez.
    console.log('\n[PRUEBA] Reenviando la misma PAYMENT-SIGNATURE...')
    const replay = await fetch(url, { headers: { 'PAYMENT-SIGNATURE': paymentHeader } })
    const replayReceipt = readPaymentResponse(replay)
    const hederaStatus = (replayReceipt?.errorMessage || '').match(/status (\w+)/)?.[1]
    console.log(`[ÉXITO] HTTP ${replay.status}: ${replayReceipt?.errorReason || 'rechazado'}${hederaStatus ? `, Hedera responde ${hederaStatus}` : ''}`)
    if (replay.status === 200) throw new Error('El pago repetido fue aceptado')

    updateState('X402_SETTLED_TX_ID', receipt.transaction)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Una sola transferencia de Hedera movió el precio del agente al comercio, y')
    console.log('el facilitador pagó la comisión. El id de la transacción sirve de recibo y de')
    console.log('protección contra repeticiones: el mismo pago nunca puede ejecutarse dos veces.')
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
