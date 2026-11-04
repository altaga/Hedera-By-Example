/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Liquidación del Facilitador con Cero Gas
 * [CONCEPTO] Ejecución Patrocinada on-chain y Pruebas de Liquidación
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Desacoplamiento de Tarifas: En Web3 tradicional, quien llama debe poseer
 * siempre tokens de gas nativos para cualquier acción. El patrón del facilitador
 * x402 en Hedera desacopla la tarifa de red del activo pagado: el Facilitador
 * actúa como el operador que envía la transacción, pagando fracciones de centavo
 * en HBAR de tarifa de red, mientras ejecuta la transferencia del activo autorizado
 * desde el agente hacia el comerciante.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Un facilitador de liquidación patrocina las comisiones de red y agrega microtransacciones, asegurando que los agentes gocen de micropagos sin gas y sin gestionar fondos adicionales para comisiones.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-1068
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M10 Lab 02: Firma de Pago del Agente
 * - Actual:   M10 Lab 03: Liquidación del Facilitador
 * - Siguiente: M10 Lab 04: Micropagos USDC en HTS
 *
 * [SECUENCIA]
 * Agente -> Servidor: Solicitud con PAYMENT-SIGNATURE
 * Servidor -> Facilitador: Verificar firma y nonce de un solo uso
 * Facilitador -> Hedera: TransferTransaction de 0.5 ℏ
 * Hedera -> Facilitador: Recibo SUCCESS
 * Servidor -> Agente: 200 OK + PAYMENT-RESPONSE (txId) + datos
 *
 * [SIMULADO]
 * Pagador y beneficiario son la misma cuenta, así que la liquidación es una transferencia real a ti mismo.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 02 de M10 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/03_facilitator_settlement.js
 * ============================================================================
 */

import {
  TransferTransaction,
  Hbar,
  PublicKey,
  AccountId
} from '@hiero-ledger/sdk'
import { getClient, getState, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

// Registro en memoria de nonces procesados para el facilitador
const processedNonces = new Set()

const verifyAgentSignature = (signedProof) => {
  const { payload, signature, publicKey } = signedProof
  const serialized = JSON.stringify(payload)
  const messageBytes = Buffer.from(serialized, 'utf8')
  const signatureBytes = Buffer.from(signature, 'hex')

  const pubKey = PublicKey.fromString(publicKey)
  return pubKey.verify(messageBytes, signatureBytes)
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Liquidación del Facilitador con Cero Gas ---\n')
  const { client, operatorId, network } = getClient()

  try {
    // 1. Ingerir la cabecera PAYMENT-SIGNATURE del Lab 02
    const headerValue = getState('X402_PAYMENT_HEADER')
    if (!headerValue) {
      throw new Error('Falta X402_PAYMENT_HEADER en state.json. Ejecuta el Lab 02 primero.')
    }

    console.log('[PROCESO] Facilitador decodificando la cabecera PAYMENT-SIGNATURE...')
    const signedProof = JSON.parse(Buffer.from(headerValue, 'base64').toString('utf8'))
    const { payload } = signedProof

    console.log(`[REGISTRO] Cuenta Pagadora:   ${payload.payer}`)
    console.log(`[REGISTRO] Cuenta Receptora:  ${payload.payee}`)
    console.log(`[REGISTRO] Monto Transferido: ${payload.amount} ${payload.asset}`)
    console.log(`[REGISTRO] Nonce Objetivo:    ${payload.nonce}`)

    // 2. Verificación Criptográfica y Anti-Replay
    console.log('\n[PROCESO] Verificando firma criptográfica y nonce de un solo uso...')
    const isValidSignature = verifyAgentSignature(signedProof)
    if (!isValidSignature) {
      throw new Error('RECHAZO CRIPTOGRÁFICO: La firma de pago no coincide con la llave pública del pagador.')
    }
    console.log('[ÉXITO] Firma criptográfica válida.')

    if (processedNonces.has(payload.nonce)) {
      throw new Error(`RECHAZO POR REPLAY: El nonce ${payload.nonce} ya ha sido liquidado previamente.`)
    }
    if (Date.now() > Number(payload.expiresAt)) {
      throw new Error('RECHAZO POR TIEMPO: La firma del desafío ha expirado.')
    }
    processedNonces.add(payload.nonce)
    console.log('[ÉXITO] Controles anti-replay superados. Nonce registrado como consumido.')

    // 3. El Facilitador ejecuta la liquidación on-chain en Hedera
    console.log('\n[PROCESO] Facilitador transmitiendo la transacción de liquidación a Hedera...')
    console.log('[INFO] El facilitador patrocina el gas; el agente solo aporta el saldo autorizado.')

    const amountHbar = Number(payload.amount)
    const payerId = AccountId.fromString(payload.payer)
    const payeeId = AccountId.fromString(payload.payee)

    // Ejecutar transferencia atómica: pagador -> receptor
    const transferTx = await new TransferTransaction()
      .addHbarTransfer(payerId, new Hbar(-amountHbar))
      .addHbarTransfer(payeeId, new Hbar(amountHbar))
      .setTransactionMemo(`x402:exact:${payload.nonce.substring(0, 8)}`)
      .freezeWith(client)

    const txResponse = await transferTx.execute(client)
    const receipt = await txResponse.getReceipt(client)
    const hashscanUrl = getHashscanUrl(txResponse)

    console.log('\n[ÉXITO] Transacción Liquidada On-Chain:')
    console.log(`[REGISTRO] Estado de Consenso: ${receipt.status.toString()}`)
    console.log(`[REGISTRO] ID de Transacción:  ${txResponse.transactionId.toString()}`)
    console.log(`[EXPLORADOR] HashScan:         ${hashscanUrl}`)

    // 4. El servidor emite HTTP 200 OK con la cabecera PAYMENT-RESPONSE
    const paymentResponseHeader = JSON.stringify({
      settled: true,
      protocol: 'x402',
      txId: txResponse.transactionId.toString(),
      hashscan: hashscanUrl,
      timestamp: Date.now()
    })

    console.log('\n[ÉXITO] El Servidor Desbloquea el Recurso: HTTP 200 OK')
    console.log(`[REGISTRO] PAYMENT-RESPONSE: ${paymentResponseHeader}`)
    console.log('[REGISTRO] Cuerpo de Datos:  {"alpha_signal": "BULLISH_CONVERGENCE", "confidence": 0.942, "depth": 14000}')

    // Persistir para trazabilidad
    updateState('X402_SETTLED_TX_ID', txResponse.transactionId.toString())
    updateState('X402_SETTLED_HASHSCAN', hashscanUrl)

    console.log('\n CONCEPTO CLAVE:')
    console.log('La prueba de liquidación es irrefutable. El comercio sirve los datos porque')
    console.log('la transacción ya alcanzó finalidad determinista en Hedera (~2.5 segundos).')
    console.log('Sin contracargos, sin comisiones bancarias y sin facturas impagadas.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en la liquidación del facilitador:', error.message)
    process.exit(1)
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
