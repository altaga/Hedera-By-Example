/**
 * ============================================================================
 * Lab 02: Firma de Pago del Agente Autónomo
 * [CONCEPTO] Una Transferencia Firmada que Nadie ha Enviado Todavía
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Autorización sin Gas: Cuando un agente de IA acepta un 402, no firma un
 * mensaje suelto de "intención". Arma la TransferTransaction real de Hedera con
 * las condiciones (-monto del agente, +monto a payTo) y la firma. Dos detalles
 * la convierten en un pago x402: su id de transacción pertenece al facilitador
 * (extra.feePayer), así que el facilitador paga la comisión de red, y el agente
 * nunca la envía. Los bytes firmados vuelven al servidor, en Base64, en la
 * cabecera PAYMENT-SIGNATURE.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los agentes autónomos no pueden tener tarjetas de crédito, y tampoco deberían necesitar gas: con quien paga la comisión en el id de transacción, al agente solo le hace falta el precio. Su firma cubre cada byte, así que nadie puede cambiar el monto ni el receptor sin invalidarla.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402/pay-with-x402
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/transactions/transaction-id
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 01: Generación del Desafío Servidor HTTP 402
 * - Siguiente: M10 Lab 03: Liquidación del Facilitador con Cero Gas
 *
 * [ SECUENCIA ]
 * Servidor -> Agente: 402 + PAYMENT-REQUIRED (0.01 ℏ, payTo, feePayer)
 * Nota Agente: Revisa su política de gasto (máximo 0.05 ℏ)
 * Nota Agente: Arma la TransferTransaction, id de transacción = feePayer, la firma
 * Agente -> Servidor: Reintenta con la cabecera PAYMENT-SIGNATURE
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallets de práctica: ACCOUNT_1 es el agente que firma.
 * - Ejecuta antes: Lab 01 de M10 (este lab lee lo que guardó).
 * - Costo: gratis (el pago se firma, no se envía).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/02_agent_payment_signature.js
 * ============================================================================
 */

import { Hbar, TransactionId, TransferTransaction } from '@hiero-ledger/sdk'
import { getClient, getState, updateState, parsePrivateKey, decodeHeader, encodeHeader, show } from '../M99_Utilities/index.js'

const MAX_PRICE_PER_CALL_TINYBARS = 5_000_000 // límite propio del agente: 0.05 HBAR

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Firma de Pago del Agente Autónomo ---\n')
  const { client } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const header = getState('X402_PAYMENT_REQUIRED')

  if (!agentId || !agentKey) {
    console.error('[FALLO] Faltan credenciales en .env (ACCOUNT_1, el agente).')
    process.exitCode = 1
    return
  }
  if (!header) {
    console.error('[FALLO] Falta X402_PAYMENT_REQUIRED en el estado. Ejecuta primero el Lab 01 de M10.')
    process.exitCode = 1
    return
  }

  try {
    // 1. Decodificar el desafío 402 del Lab 01
    console.log('[PROCESO] El agente decodifica la cabecera PAYMENT-REQUIRED...')
    const paymentRequired = decodeHeader(header)
    const accept = paymentRequired.accepts[0]
    const amount = Number(accept.amount)
    console.log(`[REGISTRO] Recurso:          ${paymentRequired.resource.url}`)
    console.log(`[REGISTRO] Precio cotizado:  ${amount} tinybars (${amount / 1e8} HBAR)`)
    console.log(`[REGISTRO] Pagar a:          ${accept.payTo}`)
    console.log(`[REGISTRO] Paga la comisión: ${accept.extra.feePayer}`)

    // 2. Evaluación autónoma de la política (límite de gasto)
    console.log(`\n[PROCESO] Evaluando la política interna de gasto (máximo permitido: ${MAX_PRICE_PER_CALL_TINYBARS / 1e8} HBAR)...`)
    if (accept.network !== 'hedera:testnet' || accept.asset !== '0.0.0') {
      throw new Error(`Forma de pago no soportada: ${accept.asset} en ${accept.network}`)
    }
    if (amount > MAX_PRICE_PER_CALL_TINYBARS) {
      throw new Error(`El precio cotizado (${amount / 1e8} HBAR) supera el techo de la política del agente (${MAX_PRICE_PER_CALL_TINYBARS / 1e8} HBAR).`)
    }
    console.log('[ÉXITO] El precio está dentro del límite de gasto. Se aprueba el pago.')

    // 3. Armar la transferencia: agente -> comercio, con la cuenta del facilitador en el id de transacción
    console.log('\n[PROCESO] Armando la TransferTransaction con las condiciones del 402...')
    const transferTx = new TransferTransaction()
      .addHbarTransfer(agentId, Hbar.fromTinybars(-amount))
      .addHbarTransfer(accept.payTo, Hbar.fromTinybars(amount))
      // La cuenta del id de transacción paga la comisión de red: el facilitador, no el agente.
      .setTransactionId(TransactionId.generate(accept.extra.feePayer))
      .freezeWith(client)

    // 4. Firmar solo con la llave del agente. No se envía nada a Hedera.
    console.log('[PROCESO] Firmando la transferencia con la llave del agente (sin enviarla)...')
    const signedTx = await transferTx.sign(parsePrivateKey(agentKey))
    const paymentPayload = {
      x402Version: 2,
      resource: paymentRequired.resource,
      accepted: accept,
      payload: { transaction: Buffer.from(signedTx.toBytes()).toString('base64') }
    }
    const paymentSignatureHeader = encodeHeader(paymentPayload)

    console.log('\n[ÉXITO] Pago x402 generado:')
    console.log(`[REGISTRO] Id de transacción:  ${signedTx.transactionId.toString()}`)
    console.log(`[REGISTRO] Comisión pagada por: ${signedTx.transactionId.accountId.toString()} (el facilitador)`)
    console.log(`[REGISTRO] Transferencias:     ${agentId} -${amount / 1e8} HBAR, ${accept.payTo} +${amount / 1e8} HBAR`)
    console.log(`[REGISTRO] Válida por:         ${signedTx.transactionValidDuration} s después de firmarse`)
    console.log(`[REGISTRO] Tamaño cabecera:    ${paymentSignatureHeader.length} bytes (base64)`)
    console.log(`[REGISTRO] PAYMENT-SIGNATURE:  ${paymentSignatureHeader.substring(0, 48)}...`)
    console.log('\n[REGISTRO] PAYMENT-SIGNATURE, decodificada (la transferencia firmada va recortada):')
    const txBase64 = paymentPayload.payload.transaction
    show.json({ ...paymentPayload, payload: { transaction: `${txBase64.substring(0, 32)}... (${Buffer.from(txBase64, 'base64').length} bytes, transferencia firmada)` } })

    // Guardar para el Lab 03 (Liquidación del Facilitador)
    updateState('X402_PAYMENT_SIGNATURE', paymentSignatureHeader)

    console.log('\n CONCEPTO CLAVE:')
    console.log('El agente firmó una transferencia real de Hedera, pero todavía no es un pago:')
    console.log('solo el facilitador del id de transacción puede completarla y enviarla, y')
    console.log('caduca 120 segundos después de firmarse. Ejecuta ahora el Lab 03 para liquidarla.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] No se pudo firmar el pago:', error.message)
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
