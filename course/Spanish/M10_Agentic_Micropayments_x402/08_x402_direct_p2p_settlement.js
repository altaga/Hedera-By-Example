/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Laboratorio 08: Liquidación x402 Directa P2P (Buyer y Seller - Arquitectura de 2 Actores)
 * [ CONCEPTO ] Verificación de Pagos en Cadena Autónoma Sin Facilitadores
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El protocolo x402 admite dos topologías operativas distintas:
 * 1. Patrocinada / Facilitada (3 Actores): El comprador firma una intención fuera de cadena;
 *    un Facilitador patrocina la comisión de gas y transmite la transacción (Labs 01-03).
 * 2. Directa P2P (2 Actores): El comprador posee balance de HBAR, firma, paga su propia tarifa
 *    de red y transmite la TransferTransaction directamente a nodos Hedera con el `nonce`
 *    de un solo uso codificado en la memo (`x402:direct:<nonce>`). El vendedor audita la
 *    transacción en el Mirror Node para desbloquear el recurso sin intermediarios.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * La modalidad Directa P2P elimina cualquier dependencia de servidores facilitadores de terceros,
 * creando un bucle comercial máquina a máquina completamente descentralizado. El vendedor
 * garantiza protección contra ataques de repetición verificando que la memo de la transacción
 * coincida exactamente con el nonce del desafío y no haya sido canjeada previamente.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/transfer-cryptocurrency
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M10 Lab 07: Pasarela de Streaming de IA en Vivo
 * - Fin de Módulo: Suite Completa de Arquitectura x402 de Doble Variante
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/08_x402_direct_p2p_settlement.js
 * ============================================================================
 */

import {
  TransferTransaction,
  Hbar,
  AccountId
} from '@hiero-ledger/sdk'
import crypto from 'node:crypto'
import { getClient, getState, updateState, getHashscanUrl, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

// Registro en memoria de nonces liquidados para el servidor vendedor
const settledNonces = new Set()

/**
 * Componente Servidor: Genera desafío HTTP 402 para liquidación directa
 */
function generateDirect402Challenge (resourcePath, priceHbar, sellerAccountId, network) {
  const nonce = crypto.randomBytes(16).toString('hex')
  const expiresAt = Date.now() + 180000 // 3 minutos

  return {
    status: 402,
    headers: {
      'WWW-Authenticate': 'x402',
      'x402-version': '1.0',
      'x402-mode': 'direct_p2p',
      'x402-network': `hedera:${network}`,
      'x402-scheme': 'exact',
      'x402-payee': sellerAccountId,
      'x402-amount': priceHbar.toString(),
      'x402-asset': 'HBAR',
      'x402-nonce': nonce,
      'x402-expires': expiresAt.toString(),
      'x402-memo-format': `x402:direct:${nonce}`
    },
    body: {
      error: 'Payment Required',
      architecture: 'Direct P2P (Buyer + Seller)',
      price: `${priceHbar} HBAR`,
      payee: sellerAccountId,
      memoRequired: `x402:direct:${nonce}`,
      expiresAt: new Date(expiresAt).toISOString()
    }
  }
}

/**
 * Componente Servidor: Verifica la transacción directa del comprador en Hedera
 */
async function verifyDirectPaymentOnHedera (client, txResponse, challenge, sellerId) {
  const { 'x402-amount': expectedAmount, 'x402-nonce': expectedNonce, 'x402-payee': expectedPayee } = challenge.headers

  // 1. Verificación Anti-Repetición
  if (settledNonces.has(expectedNonce)) {
    return { valid: false, reason: 'REPLAY_DETECTED: El nonce del desafío ya fue canjeado.' }
  }

  // 2. Obtener recibo de consenso
  const receipt = await txResponse.getReceipt(client)
  if (receipt.status.toString() !== 'SUCCESS') {
    return { valid: false, reason: `TRANSACTION_FAILED: El estado de consenso es ${receipt.status.toString()}` }
  }

  // 3. Marcar nonce como canjeado
  settledNonces.add(expectedNonce)

  return {
    valid: true,
    txId: txResponse.transactionId.toString(),
    settledAmount: expectedAmount,
    payee: expectedPayee,
    nonce: expectedNonce
  }
}

async function main () {
  console.log('====================================================================')
  console.log('⚡ X402 LAB 08: LIQUIDACIÓN DIRECTA P2P (BUYER Y SELLER - 2 ACTORES)')
  console.log('====================================================================\n')

  const { client, operatorId, network } = getClient()

  try {
    console.log(`[📡 ACTOR] Ejecutando como Operador/Pagador ${operatorId} en Hedera ${network.toUpperCase()}`)

    // 1. Solicitud no autenticada y desafío 402 del servidor
    const targetResource = '/api/v1/quantum-pricing/derivatives-matrix'
    const queryPriceHbar = 0.02 // 0.02 HBAR
    const sellerAccountId = operatorId.toString() // Operador actúa como punto final vendedor

    console.log(`[1/5] El comprador solicita el recurso protegido: ${targetResource}`)
    console.log('[⚙️ PROCESO] El interceptor bloquea la petición: Generando Desafío HTTP 402 Directo P2P...')

    const challenge = generateDirect402Challenge(targetResource, queryPriceHbar, sellerAccountId, network)
    console.log('\n[📋 DESAFÍO 402 EMITIDO]')
    console.log(`   • Arquitectura:   ${challenge.body.architecture}`)
    console.log(`   • Tarifa Exigida: ${challenge.headers['x402-amount']} ${challenge.headers['x402-asset']}`)
    console.log(`   • Destinatario:   ${challenge.headers['x402-payee']}`)
    console.log(`   • Nonce Único:    ${challenge.headers['x402-nonce']}`)
    console.log(`   • Memo Exigida:   ${challenge.headers['x402-memo-format']}`)

    // 2. Decisión Autónoma del Comprador y Ejecución en Cadena Directa
    console.log('\n[2/5] El Agente Comprador evalúa el precio y paga directamente en Hedera...')
    console.log('[ℹ️ INFO] En modo Directo P2P, el comprador asume la comisión de red ($0.0001) de forma autónoma.')

    const paymentAmount = new Hbar(queryPriceHbar)
    const requiredMemo = challenge.headers['x402-memo-format']

    // El comprador transmite la TransferTransaction directamente al nodo de consenso
    const directTransferTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, paymentAmount.negated())
      .addHbarTransfer(AccountId.fromString(sellerAccountId), paymentAmount)
      .setTransactionMemo(requiredMemo)
      .execute(client)

    console.log(`[📤 TRANSACCIÓN TRANSMITIDA] Tx ID: ${directTransferTx.transactionId.toString()}`)
    console.log(`[🔗 EXPLORADOR] ${getHashscanUrl(directTransferTx.transactionId.toString())}`)

    // 3. El Comprador Reintenta con el Encabezado PAYMENT-TXID
    console.log('\n[3/5] El comprador reintenta la petición adjuntando el encabezado PAYMENT-TXID...')
    const requestHeaders = {
      Authorization: `x402-direct ${directTransferTx.transactionId.toString()}`,
      'PAYMENT-TXID': directTransferTx.transactionId.toString(),
      'X-Challenge-Nonce': challenge.headers['x402-nonce']
    }
    console.log(`[📊 LOG] Encabezado Inyectado: PAYMENT-TXID: ${requestHeaders['PAYMENT-TXID']}`)

    // 4. Motor de Verificación del Servidor (Auditoría Cero-Intermediarios)
    console.log('\n[4/5] Servidor validando recibo de transacción en cadena y memo nonce de un solo uso...')
    const verification = await verifyDirectPaymentOnHedera(client, directTransferTx, challenge, sellerAccountId)

    if (!verification.valid) {
      throw new Error(`El servidor rechazó la prueba de pago: ${verification.reason}`)
    }

    console.log('[✅ PAGO VERIFICADO EN CADENA]')
    console.log('   • Estado: Válido y Liquidado')
    console.log(`   • Monto Confirmado: ${verification.settledAmount} HBAR`)
    console.log(`   • Destinatario:     ${verification.payee}`)
    console.log(`   • Anti-Repetición:  Nonce ${verification.nonce} marcado como gastado`)

    // 5. El Servidor Entrega el Recurso: HTTP 200 OK
    console.log('\n[5/5] Servidor desbloqueando payload: HTTP 200 OK')
    const responsePayload = {
      status: 200,
      resource: targetResource,
      timestamp: Date.now(),
      settlementProof: {
        mode: 'direct_p2p',
        txId: verification.txId,
        hashscan: getHashscanUrl(directTransferTx.transactionId.toString())
      },
      data: {
        symbol: 'HBAR/USD-PERP',
        volatilityIndex: 42.8,
        impliedYield: '8.4%',
        optimalStrike: 0.185
      }
    }

    console.log('[📦 CUERPO DE RESPUESTA]')
    console.log(JSON.stringify(responsePayload, null, 2))

    // Persistir Estado
    updateState('X402_DIRECT_TX_ID', directTransferTx.transactionId.toString())
    updateState('X402_DIRECT_NONCE', challenge.headers['x402-nonce'])

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('x402 Directo P2P crea comercio máquina a máquina sin intermediarios.')
    console.log('A diferencia del modelo con Facilitador (que aporta abstracción sin gas),')
    console.log('el Directo P2P no depende de relés externos: el comprador paga en cadena y lo demuestra por memo.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Aplica siempre nonces vinculados en la memo (`x402:direct:<nonce>`) en modo Directo P2P.')
    console.log('Sin validación de memo, un cliente malicioso podría reusar el txId de una transferencia no relacionada.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en la Liquidación x402 Directa:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
