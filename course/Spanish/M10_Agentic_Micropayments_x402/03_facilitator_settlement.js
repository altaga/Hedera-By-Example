/**
 * ============================================================================
 * Lab 03: Liquidación del Facilitador con Cero Gas
 * [CONCEPTO] Verificar, Firmar como Pagador de la Comisión y Enviar
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * La Liquidación Patrocinada: El facilitador recibe la transferencia firmada por
 * el agente y la revisa antes de aceptar pagar la comisión: que sea una
 * transferencia simple, que el id de transacción sea su propia cuenta, que no
 * haya caducado, que mueva exactamente el monto cotizado al comercio y que la
 * firma del agente sea válida. Después agrega su firma como quien paga la
 * comisión y la envía. El servidor responde 200 con la cabecera PAYMENT-RESPONSE,
 * que lleva el id de la transacción de Hedera como recibo.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * La protección contra repeticiones viene de Hedera: un id de transacción solo se ejecuta una vez, así que reenviar el mismo pago falla con DUPLICATE_TRANSACTION, y uno viejo falla porque caducó. No hace falta un registro de nonces.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402/facilitators
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 02: Firma de Pago del Agente Autónomo
 * - Siguiente: M10 Lab 04: Micropagos en Stablecoins (USDC) con HTS
 *
 * [ SECUENCIA ]
 * Agente -> Servidor: Reintenta con PAYMENT-SIGNATURE
 * Servidor -> Facilitador: Verificar la transferencia firmada
 * Nota Facilitador: Quién paga la comisión, caducidad, monto, receptor, firma del agente
 * Facilitador -> Hedera: Firma como pagador de la comisión y envía
 * Hedera -> Facilitador: Recibo SUCCESS
 * Servidor -> Agente: 200 OK + PAYMENT-RESPONSE (id de transacción)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet es el facilitador y paga la comisión de red.
 * - Wallets de práctica: ACCOUNT_1 (agente) paga 0.01 ℏ a ACCOUNT_2 (comercio).
 * - Ejecuta antes: Lab 02 de M10 (este lab lee lo que guardó).
 * - Costo: unos 0.003 ℏ de comisión para ti; 0.01 ℏ pasa entre las wallets de práctica.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/03_facilitator_settlement.js
 * ============================================================================
 */

import { PublicKey, Transaction, TransferTransaction } from '@hiero-ledger/sdk'
import {
  getClient,
  getState,
  updateState,
  getHashscanUrl,
  getMirrorNodeBaseUrl,
  parsePrivateKey,
  waitForMirror,
  ensureFunded,
  decodeHeader,
  encodeHeader,
  signExactPayment,
  getTransactionRecord
} from '../M99_Utilities/index.js'

// La llave pública del agente, tal como la conoce la red (Mirror Node).
const fetchPublicKey = async (accountId) => {
  const account = await waitForMirror(async () => {
    const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${accountId}`)
    return res.ok ? res.json() : null
  })
  if (!account) throw new Error(`No se pudo leer la llave de ${accountId} en el Mirror Node.`)
  const { key } = account
  return key._type === 'ED25519' ? PublicKey.fromStringED25519(key.key) : PublicKey.fromStringECDSA(key.key)
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Liquidación del Facilitador con Cero Gas ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const agentId = process.env.ACCOUNT_1_ID
  const agentKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const header = getState('X402_PAYMENT_SIGNATURE')

  if (!header) {
    console.error('[FALLO] Falta X402_PAYMENT_SIGNATURE en el estado. Ejecuta primero el Lab 02 de M10.')
    process.exitCode = 1
    return
  }

  try {
    // El agente debe tener el precio (no gas). Se recarga si la wallet de práctica está casi vacía.
    await ensureFunded(client, agentId, 1)

    // 1. Recibir la cabecera PAYMENT-SIGNATURE del Lab 02
    console.log('[PROCESO] El facilitador decodifica la cabecera PAYMENT-SIGNATURE...')
    let payment = decodeHeader(header)
    let tx = Transaction.fromBytes(Buffer.from(payment.payload.transaction, 'base64'))

    // Una transacción de Hedera solo es válida 120 s después de firmarse.
    const expiresAt = tx.transactionId.validStart.toDate().getTime() + tx.transactionValidDuration * 1000
    if (Date.now() > expiresAt - 10_000) {
      console.log('[INFO] El pago firmado en el Lab 02 caducó (vale 120 s). El agente lo vuelve a firmar (paso del Lab 02).')
      payment = await signExactPayment(client, { resource: payment.resource, accepts: [payment.accepted] }, agentId, agentKey)
      tx = Transaction.fromBytes(Buffer.from(payment.payload.transaction, 'base64'))
    }
    const terms = payment.accepted
    const amount = Number(terms.amount)
    console.log(`[REGISTRO] Id de transacción: ${tx.transactionId.toString()}`)
    console.log(`[REGISTRO] Condiciones:       ${amount / 1e8} HBAR a ${terms.payTo}, comisión a cargo de ${terms.extra.feePayer}`)

    // 2. Verificar antes de pagar la comisión
    console.log('\n[PROCESO] Verificando la transferencia firmada...')
    if (!(tx instanceof TransferTransaction)) throw new Error('RECHAZADO: no es una transferencia simple.')
    console.log('[ÉXITO] Es una TransferTransaction simple (sin otras operaciones).')

    if (tx.transactionId.accountId.toString() !== operatorId.toString() || terms.extra.feePayer !== operatorId.toString()) {
      throw new Error('RECHAZADO: el id de transacción no pertenece a este facilitador.')
    }
    console.log(`[ÉXITO] Quien paga la comisión es este facilitador (${operatorId}).`)

    const moves = [...tx.hbarTransfers].map(([id, hbar]) => ({ account: id.toString(), tinybars: Number(hbar.toTinybars()) }))
    const debit = moves.find((m) => m.tinybars < 0)
    const credit = moves.find((m) => m.tinybars > 0)
    if (moves.length !== 2 || credit.account !== terms.payTo || credit.tinybars !== amount || debit.tinybars !== -amount) {
      throw new Error('RECHAZADO: la transferencia no coincide con el monto y el receptor cotizados.')
    }
    if (debit.account === operatorId.toString()) throw new Error('RECHAZADO: el facilitador estaría pagando el precio.')
    console.log(`[ÉXITO] Mueve exactamente ${amount / 1e8} HBAR de ${debit.account} a ${credit.account}.`)

    const agentPublicKey = await fetchPublicKey(debit.account)
    if (!agentPublicKey.verifyTransaction(tx)) throw new Error('RECHAZADO: el pagador no firmó esta transferencia.')
    console.log(`[ÉXITO] La firma de ${debit.account} es válida (llave leída del Mirror Node).`)

    // 3. Firmar como pagador de la comisión y enviar a Hedera
    console.log('\n[PROCESO] El facilitador firma como pagador de la comisión y envía a Hedera...')
    await tx.sign(parsePrivateKey(operatorKey))
    const txResponse = await tx.execute(client)
    const receipt = await txResponse.getReceipt(client)
    const hashscanUrl = getHashscanUrl(txResponse)
    console.log('\n[ÉXITO] Transacción liquidada en la red:')
    console.log(`[REGISTRO] Estado de consenso: ${receipt.status.toString()}`)
    console.log(`[REGISTRO] Id de transacción:  ${txResponse.transactionId.toString()}`)
    console.log(`[EXPLORADOR] HashScan:        ${hashscanUrl}`)

    // 4. El servidor libera el recurso: HTTP 200 con PAYMENT-RESPONSE
    const settlement = { success: true, network: terms.network, payer: debit.account, transaction: txResponse.transactionId.toString() }
    console.log('\n[ÉXITO] El servidor libera el recurso: HTTP 200 OK')
    console.log(`[REGISTRO] PAYMENT-RESPONSE: ${encodeHeader(settlement).substring(0, 48)}...  →  ${JSON.stringify(settlement)}`)
    console.log('[REGISTRO] Cuerpo:           {"alpha_signal": "BULLISH_CONVERGENCE", "confidence": 0.942}')

    // 5. Quién pagó qué, según el Mirror Node
    const record = await waitForMirror(() => getTransactionRecord(settlement.transaction))
    if (record) {
      const net = (id) => record.transfers.filter((t) => t.account === id).reduce((sum, t) => sum + t.amount, 0) -
        (record.staking_reward_transfers || []).filter((t) => t.account === id).reduce((sum, t) => sum + t.amount, 0)
      console.log('\n[PROCESO] Leyendo la transferencia liquidada en el Mirror Node...')
      console.log(`[REGISTRO] Agente ${debit.account}:      ${net(debit.account) / 1e8} HBAR (exactamente el precio)`)
      console.log(`[REGISTRO] Comercio ${credit.account}:   +${net(credit.account) / 1e8} HBAR`)
      console.log(`[REGISTRO] Facilitador ${operatorId}: ${net(operatorId.toString()) / 1e8} HBAR (la comisión de red)`)
    }

    // 6. Repetición: enviar exactamente el mismo pago otra vez
    console.log('\n[PROCESO] Reenviando la misma PAYMENT-SIGNATURE...')
    try {
      await (await Transaction.fromBytes(tx.toBytes()).execute(client)).getReceipt(client)
      throw new Error('El pago repetido fue aceptado.')
    } catch (error) {
      if (!/DUPLICATE_TRANSACTION/.test(String(error.status || error.message))) throw error
      console.log('[ÉXITO] Hedera lo rechaza: DUPLICATE_TRANSACTION. Un pago solo se liquida una vez.')
    }

    updateState('X402_SETTLED_TX_ID', settlement.transaction)

    console.log('\n CONCEPTO CLAVE:')
    console.log('La prueba de liquidación es indiscutible: una sola transferencia de Hedera movió')
    console.log('el precio del agente al comercio, el facilitador pagó la comisión y el mismo')
    console.log('pago nunca puede liquidarse dos veces. Sin contracargos ni comisiones de tarjeta.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la liquidación del facilitador:', error.message)
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
