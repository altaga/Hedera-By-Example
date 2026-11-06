/* eslint-disable camelcase, no-unused-vars, new-cap */
/**
 * ============================================================================
 * Lab 02: El Agente Firma un Pago
 * [CONCEPTO] Un pago x402 en Hedera es una transferencia firmada que nadie ha enviado todavía
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Cuando el comprador recibe un 402, su cliente x402 construye una
 * TransferTransaction de Hedera a partir de las condiciones: -monto del
 * comprador, +monto a payTo.
 *
 * Dos detalles la convierten en un pago x402:
 *   - su id de transacción pertenece al facilitador (extra.feePayer), así que la
 *     comisión de red la paga el facilitador, no el comprador;
 *   - el comprador la firma pero no la envía. Los bytes firmados vuelven al
 *     servidor, en Base64, en la cabecera PAYMENT-SIGNATURE.
 *
 * El comprador no necesita HBAR para gas: solo necesita el precio.
 *
 * En este lab el agente firma un pago, abres el pago para ver qué contiene y el
 * facilitador lo verifica. No se envía nada, así que no se mueve dinero.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Una transferencia firmada todavía no es un pago. Se vuelve uno solo cuando quien
 * paga la comisión agrega su firma y la envía, y caduca unos 120 segundos después
 * de firmarse (la duración válida de una transacción en Hedera). La verificación
 * también detecta manipulaciones: si cambias cualquier condición que el comprador
 * aceptó, el facilitador la rechaza.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402/pay-with-x402
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/transactions/transaction-id
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 01: El Desafío de Pago HTTP 402
 * - Siguiente: M10 Lab 03: El Facilitador Liquida en Hedera
 *
 * [ SECUENCIA ]
 * Agente -> Servidor: GET /api/sentiment
 * Servidor -> Agente: 402 + PAYMENT-REQUIRED
 * Nota Agente: arma la TransferTransaction, id de transacción = feePayer, la firma
 * Agente -> Facilitador: verify(pago, condiciones)
 * Facilitador -> Agente: isValid: true (no se envió nada)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el facilitador.
 * - Wallets de práctica: ACCOUNT_1 es el agente (comprador), ACCOUNT_2 el comercio.
 * - Costo: gratis (el pago se verifica, no se envía).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/02_agent_payment_signature.js
 * ============================================================================
 */

import http from 'node:http'
import { x402ResourceServer } from '@x402/core/server'
import { encodePaymentSignatureHeader } from '@x402/core/http'
import { ExactHederaScheme } from '@x402/hedera/exact/server'
import { HBAR_ASSET_ID } from '@x402/hedera'
import {
  getClient,
  show,
  X402_NETWORK,
  createBuyer,
  createLocalFacilitator,
  paywall,
  readPaymentRequired,
  describePayment,
  toPrivateKey,
  formatHbar
} from '../M99_Utilities/index.js'

// ─── Configuración ────────────────────────────────────────────────────────────
const PORT = 4022
const ROUTE = '/api/sentiment'
const PRICE_TINYBARS = '1000000' // 0.01 ℏ

// ─── Principal ─────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- INICIO DE SESIÓN: El Agente Firma un Pago ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const merchantId = process.env.ACCOUNT_2_ID
  if (!agentId || !agentKey || !merchantId) throw new Error('Falta ACCOUNT_1 (agente) o ACCOUNT_2 (comercio). Crea las wallets de práctica o defínelas en .env.')

  let server
  try {
    // 1. Lado del comercio, como en el Lab 01: una ruta de pago y un facilitador (tu cuenta paga las comisiones).
    const { client: facilitator, feePayer } = createLocalFacilitator(operatorId, operatorKey)
    const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactHederaScheme())
    const routes = {
      [`GET ${ROUTE}`]: {
        accepts: [{ scheme: 'exact', network: X402_NETWORK, payTo: merchantId, price: { amount: PRICE_TINYBARS, asset: HBAR_ASSET_ID } }],
        description: 'Índice de sentimiento del mercado'
      }
    }
    server = http.createServer(paywall(resourceServer, routes, { [`GET ${ROUTE}`]: () => ({ sentiment: 0.72 }) }))
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

    // 2. El agente pide el recurso y recibe las condiciones del 402.
    const response = await fetch(`http://127.0.0.1:${PORT}${ROUTE}`)
    const challenge = readPaymentRequired(response)
    console.log(`[REGISTRO] HTTP ${response.status}: pagar ${formatHbar(challenge.accepts[0].amount)} a ${merchantId}, comisión a cargo de ${feePayer}`)

    // 3. El cliente x402 del agente. Rechaza activos que no conoce, así que se permite HBAR con un tope.
    const agent = createBuyer(agentId, agentKey, { maxTinybars: 5_000_000 }) // como máximo 0.05 ℏ por pago

    // 4. Firmar el pago. Solo arma y firma una transacción; no se envía nada a Hedera.
    console.log('\n[PROCESO] El agente firma el pago...')
    const payment = await agent.createPaymentPayload(challenge)

    // 5. Ver qué contiene: quién paga la comisión, quién mueve qué, quién ha firmado.
    const inside = describePayment(payment)
    console.log('[ÉXITO] Pago armado. Contiene:')
    show.table([
      { campo: 'tipo de transacción', valor: inside.type },
      { campo: 'id de transacción', valor: inside.transactionId },
      { campo: 'paga la comisión (cuenta del id)', valor: `${inside.feePayer} (el facilitador)` },
      ...inside.hbarTransfers.map((t) => ({ campo: `transferencia ${t.accountId}`, valor: formatHbar(t.amount) })),
      { campo: 'firmada por', valor: inside.signers.length === 1 && inside.signers[0] === toPrivateKey(agentKey).publicKey.toString() ? 'solo el agente' : inside.signers.join(', ') },
      { campo: 'válida por', valor: `${inside.validForSeconds} s después de firmarse` }
    ])
    const header = encodePaymentSignatureHeader(payment)
    console.log(`[REGISTRO] Viaja como PAYMENT-SIGNATURE: ${header.slice(0, 60)}… (${header.length} caracteres)`)

    // 6. El facilitador lo verifica: firma (vía el Mirror Node), montos, receptor, quién paga la comisión, saldo.
    console.log('\n[PROCESO] El facilitador verifica el pago (solo lectura)...')
    const verdict = await facilitator.verify(payment, payment.accepted)
    console.log(`[ÉXITO] verify → isValid: ${verdict.isValid}, pagador: ${verdict.payer}`)
    if (!verdict.isValid) throw new Error(`verify falló: ${verdict.invalidReason} ${verdict.invalidMessage || ''}`)

    // 7. Manipulación: un pago para un comercio distinto al de las condiciones se rechaza.
    const tampered = { ...payment, accepted: { ...payment.accepted, payTo: operatorId } }
    const rejected = await facilitator.verify(tampered, payment.accepted)
    console.log(`[PRUEBA] Misma firma, payTo cambiado → isValid: ${rejected.isValid} (${rejected.invalidReason})`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('El agente firmó una transferencia cuyo id de transacción pertenece al')
    console.log('facilitador. Es válida pero no se envió: no se movió ningún HBAR. En el Lab 03')
    console.log('el facilitador agrega su firma, paga la comisión y la envía a Hedera.')
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
