/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Tokens de Seguridad ERC-1400 y Cronogramas de Cupones de Bonos
 * [ CONCEPTO CLAVE ] Partición por Tramos y Servicio Automatizado de Deuda
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Instrumentos de Deuda Programables: Los bonos corporativos y municipales han sufrido
 * históricamente de altos costos administrativos y conciliaciones manuales de custodia.
 * El estándar ERC-1400 modela la deuda on-chain mediante particiones discretas
 * (Senior vs. Subordinada) y automatiza el pago de cupones de interés a las cuentas
 * de Hedera de los tenedores mediante transferencias atómicas programadas.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las particiones de tramos en ERC-1400 permiten a una empresa emitir deuda Senior y Mezzanine en el mismo contrato de security token, automatizando calendarios de cupones diferenciados en Hedera.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://github.com/hashgraph/asset-tokenization-studio
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M11 Lab 01: Registro de Identidad ERC-3643
 * - Actual:   M11 Lab 02: Bonos de Deuda ERC-1400
 * - Siguiente: M11 Lab 03: Roles en Stablecoin Studio
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/02_security_token_erc1400_bonds.js
 * ============================================================================
 */

import {
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TransferTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

const BOND_SPECIFICATION = {
  issuer: 'Hedera Renewable Energy Holdings Inc.',
  isin: 'US42312A1099',
  faceValueUsd: 1000,
  maturityYears: 5,
  partitions: [
    {
      partitionId: 'TRANCHE_SENIOR_SECURED',
      couponRateApy: 0.065, // 6.5% APY
      unitsIssued: 500,
      priority: 1
    },
    {
      partitionId: 'TRANCHE_MEZZANINE_YIELD',
      couponRateApy: 0.095, // 9.5% APY
      unitsIssued: 250,
      priority: 2
    }
  ]
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Emisión de Bonos ERC-1400 y Pago de Cupones ---\n')
  const { client, operatorId, network } = getClient()

  try {
    console.log(`[⚙️ PROCESO] Inicializando Estructura de Bonos para: ${BOND_SPECIFICATION.issuer}`)
    console.log(`[📊 REGISTRO] ISIN: ${BOND_SPECIFICATION.isin} | Vencimiento: ${BOND_SPECIFICATION.maturityYears} Años`)

    // 1. Emitir el Token de Seguridad en HTS representando la Serie de Bonos
    console.log('\n[⚙️ PROCESO] Desplegando token de bonos compatible con ERC-1400 en HTS...')
    const bondCreateTx = await new TokenCreateTransaction()
      .setTokenName('Green Energy 2031 Bond')
      .setTokenSymbol('BOND-GRE-31')
      .setDecimals(0)
      .setInitialSupply(750) // Unidades totales (500 Senior + 250 Mezzanine)
      .setTokenType(TokenType.FungibleCommon)
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(750)
      .setTreasuryAccountId(operatorId)
      .setAdminKey(client.operatorPublicKey)
      .setFreezeKey(client.operatorPublicKey)
      .setWipeKey(client.operatorPublicKey)
      .setTokenMemo('erc1400:isin:US42312A1099')
      .freezeWith(client)

    const bondResponse = await bondCreateTx.execute(client)
    const bondReceipt = await bondResponse.getReceipt(client)
    const bondTokenId = bondReceipt.tokenId.toString()

    console.log(`[✅ ÉXITO] Token de Bonos Corporativos Desplegado: ${bondTokenId}`)
    console.log(`[🔗 EXPLORADOR] HashScan: ${getHashscanUrl(bondResponse)}`)

    // 2. Simular Cronograma de Pago Trimestral de Cupones
    console.log('\n===============================================================')
    console.log('📅 EJECUTANDO DISTRIBUCIÓN TRIMESTRAL DE CUPONES (AUTOMATIZADO)')
    console.log('===============================================================')

    BOND_SPECIFICATION.partitions.forEach((tranche) => {
      const quarterlyRate = tranche.couponRateApy / 4
      const couponPerUnitUsd = BOND_SPECIFICATION.faceValueUsd * quarterlyRate
      const totalTranchePayoutUsd = couponPerUnitUsd * tranche.unitsIssued

      console.log(`\nTramo: ${tranche.partitionId} (Prioridad: ${tranche.priority})`)
      console.log(`- Unidades: ${tranche.unitsIssued} | APY Anual: ${(tranche.couponRateApy * 100).toFixed(1)}%`)
      console.log(`- Cupón Trimestral por Unidad: $${couponPerUnitUsd.toFixed(2)} USD`)
      console.log(`- Pago Total del Tramo:        $${totalTranchePayoutUsd.toLocaleString()} USD`)
    })

    // 3. Ejecutar Liquidación On-Chain de Cupones
    console.log('\n[⚙️ PROCESO] Ejecutando distribución atómica on-chain de cupones...')
    const couponDistributionTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-1.0)) // Distribución de rendimiento de cupones
      .addHbarTransfer(operatorId, new Hbar(1.0))
      .setTransactionMemo('erc1400:coupon_q3_2026:US42312A1099')
      .freezeWith(client)

    const couponResponse = await couponDistributionTx.execute(client)
    const couponReceipt = await couponResponse.getReceipt(client)
    const couponHashscanUrl = getHashscanUrl(couponResponse)

    console.log('\n[✅ ÉXITO] Distribución de Cupones Liquidada On-Chain:')
    console.log(`[📊 REGISTRO] Estado:            ${couponReceipt.status.toString()}`)
    console.log(`[📊 REGISTRO] ID de Transacción: ${couponResponse.transactionId.toString()}`)
    console.log(`[🔗 EXPLORADOR] HashScan:        ${couponHashscanUrl}`)

    updateState('BOND_TOKEN_ID', bondTokenId)
    updateState('BOND_COUPON_TX_ID', couponResponse.transactionId.toString())

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('ERC-1400 reemplaza los equipos manuales de servicio de bonos con liquidación')
    console.log('programática. Cupones, vencimientos y tramos de votación son gobernados por el')
    console.log('ledger, eliminando intermediarios y reduciendo costos de administración en más del 80%.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] Fallo en la emisión del bono ERC-1400:', error.message)
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
