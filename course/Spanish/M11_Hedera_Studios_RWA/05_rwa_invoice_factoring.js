/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Pipeline de Factoraje de Facturas con Activos del Mundo Real (RWA)
 * [ CONCEPTO ] Deuda Comercial Fraccionada y Liquidez Secundaria
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Desbloqueando Capital de Trabajo Ilíquido: Las pequeñas y medianas empresas (PyMEs)
 * suelen esperar de 60 a 90 días para que clientes corporativos paguen sus facturas,
 * sufriendo restricciones de liquidez severas. Al tokenizar cuentas por cobrar
 * verificadas en Hedera, las empresas pueden vender tokens fraccionados a fondos
 * globales en segundos, con liquidación automática del rendimiento al vencer la factura.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Tokenizar cuentas por cobrar brinda liquidez fraccionada en mercados secundarios a pymes, mientras que anclar el hash de la factura a HCS previene fraudes de doble facturación.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/tokenization/ats
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M11 Lab 04: Oráculo Proof-of-Reserve
 * - Actual:   M11 Lab 05: Factoraje de Facturas RWA
 * - Siguiente: M11 Lab 06: Pool Tokens Multi-Activo RWA
 *
 * [ SIMULADO ]
 * Las suscripciones de inversionistas y el pago del deudor se modelan con transferencias simples. Los tokens son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD); <0.1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/05_rwa_invoice_factoring.js
 * ============================================================================
 */

import {
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TransferTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState, reuseToken } from '../M99_Utilities/index.js'

const INVOICE_METADATA = {
  invoiceId: 'INV-2026-OCT-8842',
  debtor: 'Global Logistics Corp (Calificación AA+)',
  supplierSme: 'Precision Semiconductor Components Ltd',
  faceValueUsd: 50000,
  termDays: 60,
  annualDiscountRate: 0.08, // 8% tasa de descuento anualizada
  units: 50000 // $1 USD de valor nominal por unidad
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Pipeline de Factoraje de Facturas RWA y Liquidación ---\n')
  const { client, operatorId, network } = getClient()

  try {
    // 1. Calcular la Economía del Factoraje
    const discountAmountUsd = INVOICE_METADATA.faceValueUsd * (INVOICE_METADATA.annualDiscountRate * (INVOICE_METADATA.termDays / 365))
    const upfrontPayoutToSmeUsd = INVOICE_METADATA.faceValueUsd - discountAmountUsd
    const annualizedRoiPercent = INVOICE_METADATA.annualDiscountRate * 100

    console.log('[⚙️ PROCESO] Calculando la Economía de Tokenización de la Factura...')
    console.log(`[📊 REGISTRO] ID de Factura:         ${INVOICE_METADATA.invoiceId}`)
    console.log(`[📊 REGISTRO] Deudor Corporativo:    ${INVOICE_METADATA.debtor}`)
    console.log(`[📊 REGISTRO] Proveedor PyME:        ${INVOICE_METADATA.supplierSme}`)
    console.log(`[📊 REGISTRO] Valor Nominal:         $${INVOICE_METADATA.faceValueUsd.toLocaleString()} USD (Plazo: 60 Días)`)
    console.log(`[📊 REGISTRO] Efectivo PyME Inmediato: $${upfrontPayoutToSmeUsd.toFixed(2)} USD (Liquidez Inmediata)`)
    console.log(`[📊 REGISTRO] Rendimiento Inversor:  $${discountAmountUsd.toFixed(2)} USD (${annualizedRoiPercent}% APY)`)

    // 2. Tokenizar la Cuenta por Cobrar en HTS
    console.log('\n[⚙️ PROCESO] Acuñando 50,000 Tokens Fraccionados de Factura en Hedera Token Service...')
    const invoiceTokenId = (await reuseToken('REUSE_M11_05_TOKEN', async () => {
      // Crea el token: sus llaves (admin, supply, KYC, freeze...) deciden quién puede cambiarlo después.
      const tokenCreateTx = await new TokenCreateTransaction()
        .setTokenName(`Invoice ${INVOICE_METADATA.invoiceId}`)
        .setTokenSymbol('INV-8842')
        .setDecimals(0)
        .setInitialSupply(INVOICE_METADATA.units)
        .setTokenType(TokenType.FungibleCommon)
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(INVOICE_METADATA.units)
        .setTreasuryAccountId(operatorId)
        .setAdminKey(client.operatorPublicKey)
        .setFreezeKey(client.operatorPublicKey)
        .setTokenMemo(`rwa:invoice:${INVOICE_METADATA.invoiceId}:face_${INVOICE_METADATA.faceValueUsd}`)
        .freezeWith(client)
      // Espera el consenso: el recibo dice si la red aceptó la transacción.
      return (await (await tokenCreateTx.execute(client)).getReceipt(client)).tokenId
    })).toString()

    console.log(`[✅ ÉXITO] Token de Factura RWA Desplegado: ${invoiceTokenId}`)
    console.log(`[🔗 EXPLORADOR] HashScan: ${`https://hashscan.io/testnet/token/${invoiceTokenId}`}`)

    // 3. Simular la Suscripción del Fondo de Liquidez (Mercado Secundario)
    console.log('\n[⚙️ PROCESO] El Fondo de Liquidez adquiere los 50,000 tokens adelantando el capital...')
    // Arma la transferencia: los débitos (negativos) y créditos (positivos) de una transacción deben sumar cero.
    const subscriptionTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-0.5)) // Simulación de transferencia de liquidez
      .addHbarTransfer(operatorId, new Hbar(0.5))
      .setTransactionMemo(`rwa:factoring_advance:${INVOICE_METADATA.invoiceId}`)
      .freezeWith(client)

    const subResponse = await subscriptionTx.execute(client)
    await subResponse.getReceipt(client)
    console.log('[✅ ÉXITO] Capital Adelantado Transferido a la PyME.')

    // 4. Día 60: Pago del Deudor y Rendimiento Automatizado para Inversores
    console.log('\n===============================================================')
    console.log('📅 VENCIMIENTO: EL DEUDOR LIQUIDA EL VALOR TOTAL DE $50,000 USD')
    console.log('===============================================================')

    const payoutTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-1.0)) // Simulación de liquidación de capital + rendimiento
      .addHbarTransfer(operatorId, new Hbar(1.0))
      .setTransactionMemo(`rwa:maturity_payout:${INVOICE_METADATA.invoiceId}:full_settlement`)
      .freezeWith(client)

    const payoutResponse = await payoutTx.execute(client)
    const payoutReceipt = await payoutResponse.getReceipt(client)
    const payoutHashscanUrl = getHashscanUrl(payoutResponse)

    console.log('[✅ ÉXITO] Distribución de Rendimiento Final Liquidada On-Chain:')
    console.log(`[📊 REGISTRO] Estado:            ${payoutReceipt.status.toString()}`)
    console.log(`[📊 REGISTRO] ID de Transacción: ${payoutResponse.transactionId.toString()}`)
    console.log(`[🔗 EXPLORADOR] HashScan:        ${payoutHashscanUrl}`)

    updateState('INVOICE_TOKEN_ID', invoiceTokenId)
    updateState('INVOICE_SETTLEMENT_TX_ID', payoutResponse.transactionId.toString())

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('La tokenización de RWAs conecta el comercio del mundo real con las DeFi.')
    console.log('Hedera elimina la fricción de conciliación, permitiendo a las empresas acceder a')
    console.log('liquidez global instantánea a una fracción de los costos del factoraje bancario clásico.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Fallo en la simulación de factoraje de factura:', error.message)
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
