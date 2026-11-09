/**
 * ============================================================================
 * Lab 05: Pipeline de Factoraje de Facturas con Activos del Mundo Real (RWA)
 * [CONCEPTO] Cuentas por Cobrar Tokenizadas, Entrega contra Pago y Redención On-Chain
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Las PyMEs suelen esperar 60-90 días a que grandes compradores paguen sus facturas.
 * Tokenizar la cuenta por cobrar permite que un inversor la compre hoy con descuento y
 * cobre el valor nominal completo cuando pague el deudor. Este lab ejecuta el ciclo
 * completo entre tres cuentas de testnet reales y distintas:
 * 1. La PyME ancla el hash de la factura en HCS (evita la doble facturación) y emite
 *    un token de factura con ELLA MISMA como tesorería.
 * 2. Anticipo: UNA transacción atómica intercambia el HBAR con descuento del inversor por
 *    todos los tokens de factura (entrega contra pago: ningún tramo ocurre por separado).
 * 3. Vencimiento: UNA transacción atómica mueve el valor nominal del deudor al inversor y
 *    devuelve los tokens de factura a la tesorería de la PyME (redención).
 * 4. Los saldos del Mirror Node confirman quién ganó qué.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las TransferTransactions atómicas multiparte dan entrega contra pago sin contrato de
 * escrow. Los montos están escalados a tinybars para testnet (1 unidad de factura =
 * 100 tinybars).
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 * - https://docs.hedera.com/solutions/tokenization/ats
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M11 Lab 04: Oráculo Proof-of-Reserve (PoR) y Disyuntores de Seguridad
 * - Siguiente: M11 Lab 06: Pool Tokens Multi-Activo Institucionales y Canastas RWA
 *
 * [ SECUENCIA ]
 * PyME -> Hedera: Ancla el hash de la factura en HCS y emite el token de factura
 * Inversor -> PyME: HBAR con descuento por todos los tokens (entrega contra pago atómica)
 * Deudor -> Inversor: Valor nominal completo al vencimiento
 * Inversor -> PyME: Tokens de factura redimidos en la misma transacción
 *
 * [ SIMULADO ]
 * Los datos de la factura son de ejemplo y el vencimiento ocurre de inmediato en lugar de a los 60 días; los montos están escalados a tinybars. Las tres partes son cuentas reales y cada pago es real.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (crea 3 cuentas desechables: PyME, inversor, deudor).
 * - Costo: ~18 ℏ (el operador paga la creación del token, ~15 ℏ) + ~0.7 ℏ para cuentas desechables + comisiones.
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/05_rwa_invoice_factoring.js
 * ============================================================================
 */

import crypto from 'node:crypto'
import {
  Hbar,
  TokenCreateTransaction,
  TokenSupplyType,
  TokenType,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { createClient, createLabAccount, getClient, getHashscanUrl, getMirrorHbarTinybars, sleep, updateState } from '../M99_Utilities/index.js'

const INVOICE = {
  invoiceId: 'INV-2026-OCT-8842',
  debtor: 'Global Logistics Corp (AA+ Rated)',
  supplierSme: 'Precision Semiconductor Components Ltd',
  faceValueUsd: 50000,
  termDays: 60,
  annualDiscountRate: 0.08,
  units: 50000 // $1 de valor nominal por unidad
}
const TINYBARS_PER_UNIT = 100 // escala testnet

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Pipeline de Factoraje y Liquidación de Facturas RWA ---\n')
  const { client } = getClient()

  try {
    // 1. Economía
    const faceTinybars = INVOICE.units * TINYBARS_PER_UNIT
    const discountTinybars = Math.floor(faceTinybars * INVOICE.annualDiscountRate * (INVOICE.termDays / 365))
    const advanceTinybars = faceTinybars - discountTinybars
    console.log('[PROCESO] Paso 1: Economía de la factura')
    console.log(`[REGISTRO] ${INVOICE.invoiceId}  | Deudor: ${INVOICE.debtor} | PyME: ${INVOICE.supplierSme}`)
    console.log(`[REGISTRO] Nominal ${faceTinybars} tinybars | Anticipo ${advanceTinybars} | Descuento del inversor ${discountTinybars} (${INVOICE.annualDiscountRate * 100}% anual, ${INVOICE.termDays} días)`)

    // 2. Tres partes reales
    console.log('\n[PROCESO] Paso 2: Creando las cuentas de PyME, inversor y deudor...')
    const sme = await createLabAccount(client, { hbar: 0.3 })
    const investor = await createLabAccount(client, { hbar: 0.2 })
    const debtor = await createLabAccount(client, { hbar: 0.2 })
    console.log(`[REGISTRO] PyME ${sme.accountId} | Inversor ${investor.accountId} | Deudor ${debtor.accountId}`)
    const smeClient = createClient(sme.accountId.toString(), sme.privateKey)

    // 3. La PyME ancla la factura y emite el token de la cuenta por cobrar (la PyME es tesorería)
    console.log('\n[PROCESO] Paso 3: La PyME ancla el hash de la factura en HCS y emite el token de factura...')
    const invoiceHash = crypto.createHash('sha256').update(JSON.stringify(INVOICE)).digest('hex')
    const topicId = (await (await new TopicCreateTransaction().setTopicMemo('hbe:invoice-registry').execute(smeClient)).getReceipt(smeClient)).topicId
    await (await new TopicMessageSubmitTransaction().setTopicId(topicId)
      .setMessage(JSON.stringify({ type: 'invoice-anchor', invoiceId: INVOICE.invoiceId, sha256: invoiceHash }))
      .execute(smeClient)).getReceipt(smeClient)
    const tokenId = (await (await (await new TokenCreateTransaction()
      .setTokenName(`Invoice ${INVOICE.invoiceId}`)
      .setTokenSymbol('INV-8842')
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(0)
      .setInitialSupply(INVOICE.units)
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(INVOICE.units)
      .setTreasuryAccountId(sme.accountId)
      .setAdminKey(sme.privateKey.publicKey)
      .setTokenMemo(`rwa:invoice:${INVOICE.invoiceId}:sha256:${invoiceHash.slice(0, 16)}`)
      // El operador paga la tarifa de creación (~15 ℏ); la PYME firma como tesorería y admin
      .freezeWith(client)
      .sign(sme.privateKey)).execute(client)).getReceipt(client)).tokenId
    console.log(`[ÉXITO] Factura anclada en el topic ${topicId}; token ${tokenId} (tesorería: PyME)`)

    // 4. Anticipo: entrega contra pago atómica
    console.log('\n[PROCESO] Paso 4: El inversor compra la cuenta por cobrar — HBAR y tokens se intercambian de forma atómica...')
    const advanceTx = await new TransferTransaction()
      .addHbarTransfer(investor.accountId, Hbar.fromTinybars(-advanceTinybars))
      .addHbarTransfer(sme.accountId, Hbar.fromTinybars(advanceTinybars))
      .addTokenTransfer(tokenId, sme.accountId, -INVOICE.units)
      .addTokenTransfer(tokenId, investor.accountId, INVOICE.units)
      .setTransactionMemo(`rwa:factoring_advance:${INVOICE.invoiceId}`)
      .freezeWith(client)
    await advanceTx.sign(investor.privateKey)
    await advanceTx.sign(sme.privateKey)
    const advanceRes = await advanceTx.execute(client)
    await advanceRes.getReceipt(client)
    console.log(`[ÉXITO] Anticipo liquidado — ${advanceRes.transactionId} | ${getHashscanUrl(advanceRes)}`)

    // 5. Vencimiento: el deudor paga el nominal; los tokens se redimen a la tesorería de la PyME
    console.log('\n[PROCESO] Paso 5: Vencimiento — el deudor paga al inversor; los tokens de factura se redimen...')
    const invBefore = await getMirrorHbarTinybars(investor.accountId.toString())
    const maturityTx = await new TransferTransaction()
      .addHbarTransfer(debtor.accountId, Hbar.fromTinybars(-faceTinybars))
      .addHbarTransfer(investor.accountId, Hbar.fromTinybars(faceTinybars))
      .addTokenTransfer(tokenId, investor.accountId, -INVOICE.units)
      .addTokenTransfer(tokenId, sme.accountId, INVOICE.units)
      .setTransactionMemo(`rwa:maturity_payout:${INVOICE.invoiceId}`)
      .freezeWith(client)
    await maturityTx.sign(debtor.privateKey)
    await maturityTx.sign(investor.privateKey)
    const maturityRes = await maturityTx.execute(client)
    await maturityRes.getReceipt(client)
    console.log(`[ÉXITO] Vencimiento liquidado — ${maturityRes.transactionId} | ${getHashscanUrl(maturityRes)}`)

    await sleep(6000)
    const invAfter = await getMirrorHbarTinybars(investor.accountId.toString())
    console.log(`[VERIFICACIÓN] El inversor recibió ${invAfter - invBefore} tinybars al vencimiento (pagó ${advanceTinybars} por adelantado, ganancia ${faceTinybars - advanceTinybars})`)
    smeClient.close()

    updateState('RWA_INVOICE_TOKEN_ID', tokenId.toString())
    updateState('RWA_INVOICE_TOPIC_ID', topicId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Tres partes independientes liquidaron un ciclo de factoraje con dos transacciones atómicas:')
    console.log('el dinero y la cuenta por cobrar siempre se movieron juntos, sin contrato de escrow.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló el factoraje de facturas:', error.message)
    process.exit(1)
  } finally {
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
