/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Firma de Pago del Agente Autónomo
 * [ CONCEPTO CLAVE ] Firmas Criptográficas de Intención de Pago
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Autorización Protegida contra Ataques de Replay: Cuando un agente de IA acepta
 * pagar por la respuesta de una API, firma un payload determinista vinculando el
 * monto exacto, destinatario, nonce del servidor y tiempo de expiración mediante
 * su llave privada. Dado que el nonce es único y de un solo uso, los intermediarios
 * maliciosos no pueden reutilizar (replay) la firma para drenar la cuenta del agente.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los modelos de IA autónomos no pueden tener tarjetas de crédito ni contraseñas bancarias. Firmar intenciones de pago con llaves criptográficas permite a los agentes comprar inteligencia por petición sin fricciones.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/core-concepts/keys-and-signatures
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M10 Lab 01: Desafío 402 del Servidor
 * - Actual:   M10 Lab 02: Firma de Pago del Agente
 * - Siguiente: M10 Lab 03: Liquidación del Facilitador
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/02_agent_payment_signature.js
 * ============================================================================
 */

import crypto from 'crypto'
import { PrivateKey } from '@hiero-ledger/sdk'
import { getClient, getState, updateState } from '../M99_Utilities/index.js'

const signPaymentIntent = (signerKey, paymentPayload) => {
  // Normalizar payload a string JSON determinista
  const serialized = JSON.stringify(paymentPayload)
  const messageBytes = Buffer.from(serialized, 'utf8')

  // Firmar usando el firmante criptográfico de Hedera
  const signatureBytes = signerKey.sign(messageBytes)
  const signatureHex = Buffer.from(signatureBytes).toString('hex')

  return {
    payload: paymentPayload,
    signature: signatureHex,
    publicKey: signerKey.publicKey.toStringDer()
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Firma de Pago del Agente Autónomo ---\n')
  const { client, operatorId, operatorKey, network } = getClient()

  try {
    // 1. Recuperar el desafío del Lab 01
    const resource = getState('X402_CHALLENGE_RESOURCE') || '/api/v1/alpha-intelligence/market-depth'
    const amount = Number(getState('X402_CHALLENGE_AMOUNT')) || 0.5
    const payee = getState('X402_CHALLENGE_PAYEE') || operatorId.toString()
    const nonce = getState('X402_CHALLENGE_NONCE') || crypto.randomBytes(16).toString('hex')
    const expiresAt = Number(getState('X402_CHALLENGE_EXPIRES')) || (Date.now() + 120000)

    console.log('[⚙️ PROCESO] Agente interpretando parámetros del desafío HTTP 402...')
    console.log(`[📊 REGISTRO] Recurso Objetivo:  ${resource}`)
    console.log(`[📊 REGISTRO] Precio Cotizado:   ${amount} HBAR`)
    console.log(`[📊 REGISTRO] Cuenta Receptora:  ${payee}`)
    console.log(`[📊 REGISTRO] Nonce del Desafío: ${nonce}`)

    // 2. Evaluación de Política Autónoma (Límite de Presupuesto)
    const MAX_PRICE_PER_CALL_HBAR = 1.0 // Límite interno del agente
    console.log(`\n[⚙️ PROCESO] Evaluando política de gasto interno (Máximo Permitido: ${MAX_PRICE_PER_CALL_HBAR} HBAR)...`)

    if (amount > MAX_PRICE_PER_CALL_HBAR) {
      throw new Error(`El precio cotizado (${amount} HBAR) excede el límite del agente (${MAX_PRICE_PER_CALL_HBAR} HBAR).`)
    }
    console.log('[✅ ÉXITO] El precio encaja en la política de gasto autónomo. Aprobando intención de pago.')

    // 3. Construir el payload determinista de autorización de pago
    const paymentPayload = {
      protocol: 'x402',
      version: '1.0',
      network: `hedera:${network}`,
      scheme: 'exact',
      payer: operatorId.toString(),
      payee,
      amount: amount.toString(),
      asset: 'HBAR',
      nonce,
      expiresAt,
      timestamp: Date.now()
    }

    // 4. Firmar criptográficamente la intención con la llave privada del agente
    console.log('\n[⚙️ PROCESO] Firmando prueba de autorización de pago con la llave del agente...')
    const signerKey = PrivateKey.fromStringDer(operatorKey)
    const signedProof = signPaymentIntent(signerKey, paymentPayload)

    // Codificar en cabecera estándar x402 base64
    const paymentHeaderValue = Buffer.from(JSON.stringify(signedProof)).toString('base64')

    console.log('\n[✅ ÉXITO] Prueba Criptográfica de Pago Generada:')
    console.log(`[📊 REGISTRO] Cuenta Pagadora:       ${paymentPayload.payer}`)
    console.log(`[📊 REGISTRO] Llave Pública (DER):   ${signedProof.publicKey.substring(0, 32)}...`)
    console.log(`[📊 REGISTRO] Firma (Hex):           ${signedProof.signature.substring(0, 32)}...`)
    console.log(`[📊 REGISTRO] Tamaño de Cabecera:    ${paymentHeaderValue.length} bytes (base64)`)
    console.log(`[📊 REGISTRO] PAYMENT-SIGNATURE:     ${paymentHeaderValue.substring(0, 48)}...`)

    // Persistir para el Lab 03 Liquidación del Facilitador
    updateState('X402_PAYMENT_PAYLOAD', JSON.stringify(paymentPayload))
    updateState('X402_PAYMENT_SIGNATURE', signedProof.signature)
    updateState('X402_PAYMENT_HEADER', paymentHeaderValue)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('El agente firma una prueba de autorización, NO la fontanería de red ni gas.')
    console.log('La firma prueba que el titular autorizó una transferencia de 0.5 HBAR')
    console.log('específicamente para el nonce ' + nonce + '. Ningún intermediario puede')
    console.log('alterar el monto ni desviar fondos sin invalidar la firma criptográfica.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Fallo al firmar la intención de pago:', error.message)
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
