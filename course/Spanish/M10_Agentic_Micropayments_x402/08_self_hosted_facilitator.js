/**
 * ============================================================================
 * Lab 08: Liquidación entre Dos Partes (el Comercio como Facilitador)
 * [CONCEPTO] x402 entre un Comprador y un Vendedor, sin Terceros
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Dos Topologías, un Protocolo: En los Labs 01-07 participaron tres partes: el
 * comprador, el vendedor y un facilitador que pagaba la comisión de red. El
 * vendedor también puede ser su propio facilitador: pone su cuenta en
 * extra.feePayer, verifica la transferencia firmada por el comprador, la firma y
 * la envía. El comprador hace exactamente lo mismo que antes y sigue sin necesitar
 * HBAR para gas; el vendedor recibe el precio, paga la comisión con parte de él y
 * luego audita la liquidación en el Mirror Node.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El formato no cambia entre topologías: el comprador no sabe, ni necesita saber, quién aloja el facilitador. Alojarlo implica tener una llave con fondos que firma pagos, así que sus revisiones (quién paga la comisión, monto, receptor, firma, caducidad) son las que protegen al vendedor.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/ai/x402/facilitators
 * - https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_hedera.md
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M10 Lab 07: Pasarela Proxy de Streaming de IA (SSE + Liquidación x402)
 * - Siguiente: M11 Lab 01: Transferencias RWA con Permisos — Registro de Identidad + KYC de HTS (Conceptos ERC-3643)
 *
 * [ SECUENCIA ]
 * Comprador -> Vendedor: GET /api/v1/quantum-pricing/derivatives-matrix
 * Vendedor -> Comprador: 402 (payTo = feePayer = vendedor)
 * Nota Comprador: Firma la transferencia, como en el Lab 02
 * Comprador -> Vendedor: Reintenta con PAYMENT-SIGNATURE
 * Vendedor -> Hedera: Verifica, firma y envía con su propia llave
 * Vendedor -> Hedera: Audita la liquidación en el Mirror Node
 * Vendedor -> Comprador: 200 OK + PAYMENT-RESPONSE
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet solo recarga las wallets de práctica si les falta saldo.
 * - Wallets de práctica: ACCOUNT_1 es el comprador, ACCOUNT_2 el vendedor (y su propio facilitador).
 * - Costo: 0.01 ℏ de ACCOUNT_1 a ACCOUNT_2; ACCOUNT_2 paga unos 0.003 ℏ de comisiones.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M10_Agentic_Micropayments_x402/08_self_hosted_facilitator.js
 * ============================================================================
 */

import {
  getClient,
  createClient,
  updateState,
  getHashscanUrl,
  ensureFunded,
  waitForMirror,
  encodeHeader,
  decodeHeader,
  createPaymentRequired,
  signExactPayment,
  verifyExactPayment,
  settleExactPayment,
  getTransactionRecord
} from '../M99_Utilities/index.js'

const main = async () => {
  console.log('====================================================================')
  console.log('X402 LAB 08: LIQUIDACIÓN ENTRE DOS PARTES (EL COMERCIO COMO FACILITADOR)')
  console.log('====================================================================\n')
  const { client } = getClient()
  const buyerId = process.env.ACCOUNT_1_ID
  const buyerKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const sellerId = process.env.ACCOUNT_2_ID
  const sellerKey = process.env.ACCOUNT_2_PRIVATE_KEY

  if (!buyerId || !buyerKey || !sellerId || !sellerKey) {
    console.error('[FALLO] Faltan credenciales en .env (ACCOUNT_1 comprador, ACCOUNT_2 vendedor).')
    process.exitCode = 1
    return
  }

  // El vendedor firma y paga con su propia cuenta.
  const sellerClient = createClient(sellerId, sellerKey)

  try {
    // El comprador necesita el precio; el vendedor necesita HBAR para las comisiones que ahora paga.
    await ensureFunded(client, buyerId, 1)
    await ensureFunded(client, sellerId, 1)

    // 1. El vendedor emite el 402: es a la vez payTo y feePayer
    const priceTinybars = 1_000_000 // 0.01 HBAR
    console.log('[PROCESO] Fase 1: El vendedor emite HTTP 402 consigo mismo como pagador de la comisión...')
    const paymentRequiredHeader = encodeHeader(createPaymentRequired({
      resource: '/api/v1/quantum-pricing/derivatives-matrix',
      description: 'Matriz de volatilidad de derivados',
      payTo: sellerId,
      amount: priceTinybars,
      feePayer: sellerId
    }))
    console.log(`[REGISTRO] PAYMENT-REQUIRED: ${priceTinybars / 1e8} HBAR a ${sellerId}, comisión a cargo de ${sellerId}`)

    // 2. El comprador firma, exactamente igual que con un facilitador externo
    console.log('\n[PROCESO] Fase 2: El comprador firma la transferencia (no necesita HBAR para gas)...')
    const payment = await signExactPayment(client, decodeHeader(paymentRequiredHeader), buyerId, buyerKey)
    const paymentSignatureHeader = encodeHeader(payment)
    console.log(`[REGISTRO] PAYMENT-SIGNATURE: ${paymentSignatureHeader.substring(0, 48)}...`)

    // 3. El vendedor verifica el pago con sus propias revisiones de facilitador
    console.log('\n[PROCESO] Fase 3: El vendedor verifica la transferencia firmada...')
    const check = await verifyExactPayment(decodeHeader(paymentSignatureHeader), sellerId)
    if (!check.isValid) throw new Error(`Pago rechazado: ${check.invalidReason}`)
    console.log(`[ÉXITO] Válido: pagador de la comisión, monto, receptor y firma de ${check.payer} correctos.`)

    // 4. El vendedor firma como pagador de la comisión y envía con su propio cliente
    console.log('\n[PROCESO] Fase 4: El vendedor firma y envía a Hedera...')
    const settlement = await settleExactPayment(sellerClient, decodeHeader(paymentSignatureHeader), sellerKey)
    if (!settlement.success) throw new Error(`Falló la liquidación: ${settlement.errorReason}`)
    console.log(`[ÉXITO] ¡Liquidado! Estado: ${settlement.status}`)
    console.log(`[REGISTRO] Id de transacción: ${settlement.transaction}`)
    console.log(`[EXPLORADOR] HashScan: ${getHashscanUrl(settlement.transaction)}`)

    // 5. El vendedor audita la liquidación en el Mirror Node antes de entregar los datos
    console.log('\n[PROCESO] Fase 5: El vendedor audita la transacción en el Mirror Node...')
    const record = await waitForMirror(() => getTransactionRecord(settlement.transaction))
    if (!record || record.result !== 'SUCCESS') throw new Error('La liquidación todavía no aparece en el Mirror Node.')
    const net = (id) => record.transfers.filter((t) => t.account === id).reduce((sum, t) => sum + t.amount, 0) -
      (record.staking_reward_transfers || []).filter((t) => t.account === id).reduce((sum, t) => sum + t.amount, 0)
    console.log(`[REGISTRO] Comprador ${buyerId}: ${net(buyerId) / 1e8} HBAR`)
    console.log(`[REGISTRO] Vendedor ${sellerId}:  +${net(sellerId) / 1e8} HBAR (precio ${priceTinybars / 1e8} − comisión ${record.charged_tx_fee / 1e8})`)

    console.log('\n[ÉXITO] El vendedor libera el recurso: HTTP 200 OK')
    console.log(`[REGISTRO] PAYMENT-RESPONSE: ${JSON.stringify({ success: true, network: settlement.network, payer: settlement.payer, transaction: settlement.transaction })}`)
    console.log('[REGISTRO] Cuerpo: {"symbol": "HBAR/USD-PERP", "volatilityIndex": 42.8}')

    // 6. Comparación de arquitecturas
    console.log('\n===================================================================')
    console.log('TOPOLOGÍAS X402 EN HEDERA')
    console.log('===================================================================')
    console.log('Tres partes (Labs 01-07): el comprador firma, un facilitador paga la comisión y envía')
    console.log('Dos partes (este lab):    el comprador firma, el vendedor paga la comisión y envía')
    console.log('Igual en ambas:           PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE,')
    console.log('                          el comprador nunca necesita HBAR para gas')
    console.log('===================================================================')

    updateState('X402_SELF_HOSTED_TX_ID', settlement.transaction)

    console.log('\n CONCEPTO CLAVE:')
    console.log('No participó ningún intermediario: el vendedor verificó, firmó y envió el pago')
    console.log('por sí mismo, y lo auditó en el Mirror Node. El comprador no hizo nada distinto,')
    console.log('porque los mensajes x402 son los mismos en ambas topologías.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la liquidación entre dos partes:', error.message)
    process.exitCode = 1
  } finally {
    sellerClient.close()
    client.close()
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
