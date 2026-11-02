/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 08: Asset Tokenization Studio — Acciones Corporativas y Motor de Pagos Masivos
 * [ CONCEPTO ] Snapshots de Cap Table en Consenso, Motor de Dividendos y Liquidación Atómica
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En la arquitectura oficial de Hedera Asset Tokenization Studio (ATS)
 * (packages/mass-payout y packages/ats/contracts), los tokens de seguridad y los
 * activos del mundo real (RWAs) no son instrumentos estáticos. A lo largo de su
 * ciclo de vida, los emisores deben ejecutar Acciones Corporativas reguladas:
 * 1. Distribución de Dividendos (Renta Variable y Unidades de Fondos)
 * 2. Pagos de Cupones (Tramos de Deuda y Bonos)
 * 3. Captura de Snapshots de Cap Table en una marca de tiempo inmutable de consenso de Hedera.
 *
 * Las finanzas tradicionales sufren días de retraso en la liquidación y millones
 * en comisiones a intermediarios para conciliar pagos de dividendos entre bancos custodios.
 *
 * ATS soluciona esto mediante una canalización de Pagos Masivos atómica y auditable:
 * - Snapshot en Consensus Timestamp: Congela los saldos del cap table en un instante exacto.
 * - Motor de Dividendos Prorrateados: Calcula derechos pro-rata y lógica de retención fiscal.
 * - Liquidación Atómica Multipartita: Ejecuta una única transacción de transferencia
 *   por lotes donde todos los pagos a inversores se liquidan simultáneamente en subsegundos.
 * - Certificación Regulatoria en HCS: Ancla un rastro de auditoría inmutable en el Hedera
 *   Consensus Service para escrutinio regulatorio de la SEC, FINRA o MiCA.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Nunca disperses dividendos institucionales usando transferencias individuales en un bucle.
 * Un fallo de red o tiempo de espera a mitad del bucle genera insolvencia de liquidación parcial.
 * En Hedera, las transferencias por lotes dentro de una `TransferTransaction` atómica
 * garantizan que TODOS los inversores cobren simultáneamente o ninguno lo haga.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M11 Lab 07: Puente de Facturación ERP Institucional
 * - Siguiente: M12 Lab 01: Herramientas EVM Modernas con Viem y Foundry
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Ejecuta antes: Lab 01 de M11 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/08_ats_corporate_actions_mass_payout.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  AccountId,
  Hbar,
  Timestamp,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import {
  getClient,
  getHashscanUrl,
  getState,
  updateState
} from '../M99_Utilities/index.js'

/**
 * 1. Motor de Instantáneas (Snapshot) de Cap Table de ATS
 * Captura la tenencia de tokens en las billeteras de los inversores en tiempo de consenso.
 */
class AtsCapTableSnapshotEngine {
  constructor (securityTokenSymbol, recordTimestamp) {
    this.securityTokenSymbol = securityTokenSymbol
    this.recordTimestamp = recordTimestamp
    this.investors = []
  }

  registerShareholder (accountId, name, tranche, sharesHeld, jurisdiction) {
    this.investors.push({
      accountId: accountId.toString(),
      name,
      tranche, // Tramo Senior, Mezzanine o Renta Variable Común
      sharesHeld: BigInt(sharesHeld),
      jurisdiction
    })
  }

  generateSnapshot () {
    const totalShares = this.investors.reduce((sum, inv) => sum + inv.sharesHeld, 0n)

    const capTable = this.investors.map((inv) => {
      const ownershipRatio = Number(inv.sharesHeld) / Number(totalShares)
      return {
        ...inv,
        ownershipPercentage: (ownershipRatio * 100).toFixed(2) + '%',
        ownershipRatio
      }
    })

    return {
      recordTimestamp: this.recordTimestamp,
      securityToken: this.securityTokenSymbol,
      totalShares: totalShares.toString(),
      totalHolders: capTable.length,
      capTable
    }
  }
}

/**
 * 2. Motor de Cálculo de Acciones Corporativas Prorrateadas
 * Calcula los derechos netos de dividendos o cupones por cada accionista.
 */
class AtsDividendCalculationEngine {
  constructor (totalDividendBudgetTinybars, currencySymbol = 'HBAR') {
    this.totalDividendBudget = BigInt(totalDividendBudgetTinybars)
    this.currencySymbol = currencySymbol
  }

  computePayouts (snapshot) {
    const totalShares = BigInt(snapshot.totalShares)
    let totalAllocated = 0n

    const payouts = snapshot.capTable.map((holder) => {
      // Derecho prorrateado: (accionesTenedor * presupuestoTotal) / accionesTotales
      const grossEntitlement = (holder.sharesHeld * this.totalDividendBudget) / totalShares

      // Regla de Compliance de ATS: Aplicar retención fiscal para tramos internacionales
      let withholdingRate = 0.0
      if (holder.jurisdiction !== 'US' && holder.jurisdiction !== 'DOMESTICO') {
        withholdingRate = 0.15 // Retención fiscal transfronteriza del 15%
      }

      const withholdingAmount = BigInt(Math.floor(Number(grossEntitlement) * withholdingRate))
      const netPayout = grossEntitlement - withholdingAmount
      totalAllocated += netPayout

      return {
        accountId: holder.accountId,
        name: holder.name,
        tranche: holder.tranche,
        sharesHeld: holder.sharesHeld.toString(),
        grossEntitlementTinybars: grossEntitlement.toString(),
        withholdingRate: (withholdingRate * 100).toFixed(1) + '%',
        withholdingTinybars: withholdingAmount.toString(),
        netPayoutTinybars: netPayout.toString(),
        netPayoutHbar: (Number(netPayout) / 100000000).toFixed(6)
      }
    })

    return {
      totalBudgetTinybars: this.totalDividendBudget.toString(),
      totalNetDispersedTinybars: totalAllocated.toString(),
      payouts
    }
  }
}

const main = async () => {
  console.log('====================================================================')
  console.log('🏛️ ASSET TOKENIZATION STUDIO: ACCIONES CORPORATIVAS Y PAGOS MASIVOS')
  console.log('====================================================================\n')

  const { client, operatorId, operatorKey } = getClient()

  // 1. Configurar el activo de seguridad y el Cap Table de inversores
  const securityTokenSymbol = 'ATS-TREX-BOND-2027'
  const recordTimestamp = Timestamp.fromDate(new Date()).toString()

  console.log('[1/4] 📸 Generando Instantánea de Cap Table en Consenso para Acción Corporativa...')
  const snapshotEngine = new AtsCapTableSnapshotEngine(securityTokenSymbol, recordTimestamp)

  // Registrar cuentas de inversores institucionales
  const investor1 = process.env.ACCOUNT_1_ID || '0.0.11226623'
  const investor2 = process.env.ACCOUNT_2_ID || '0.0.8707881'

  snapshotEngine.registerShareholder(investor1, 'Acme Institutional Fund LP', 'Tramo de Deuda Senior A', 600000, 'US')
  snapshotEngine.registerShareholder(investor2, 'Zurich Global Wealth AG', 'Tramo de Deuda Senior A', 400000, 'CH')

  const snapshot = snapshotEngine.generateSnapshot()
  console.log(`   Token de Seguridad:    ${snapshot.securityToken}`)
  console.log(`   Marca de Tiempo:       ${snapshot.recordTimestamp}`)
  console.log(`   Acciones Totales:      ${snapshot.totalShares}`)
  console.log(`   Tenedores Registrados: ${snapshot.totalHolders}`)
  snapshot.capTable.forEach((h) => {
    console.log(`     • ${h.name} (${h.accountId}): ${h.sharesHeld} acciones (${h.ownershipPercentage}) [${h.jurisdiction}]`)
  })
  console.log()

  // 2. Computar pagos prorrateados de dividendos / cupones
  // Pool de dividendos: 2.0 HBAR total para dispersión masiva entre inversores de Testnet
  const totalDividendPool = Hbar.from(2.0).toTinybars()
  console.log('[2/4] 🧮 Ejecutando Motor de Cálculo de Dividendos Prorrateados de ATS...')
  const calcEngine = new AtsDividendCalculationEngine(totalDividendPool.toString(), 'HBAR')
  const distributionPlan = calcEngine.computePayouts(snapshot)

  console.log(`   Pool Total de Dividendos: ${Hbar.fromTinybars(distributionPlan.totalBudgetTinybars).toString()}`)
  console.log(`   Dispersión Neta Total:    ${Hbar.fromTinybars(distributionPlan.totalNetDispersedTinybars).toString()}`)
  distributionPlan.payouts.forEach((p) => {
    console.log(`     → Pago a ${p.name} (${p.accountId}):`)
    console.log(`        Bruto: ${p.grossEntitlementTinybars} tinybars | Impuesto: ${p.withholdingRate} | Neto: ${p.netPayoutHbar} HBAR`)
  })
  console.log()

  // 3. Ejecutar liquidación atómica por lotes de pagos masivos en Hedera
  console.log('[3/4] ⚡ Ejecutando Pago Masivo Atómico Multipartito en el Consenso de Hedera...')
  const netLegs = distributionPlan.payouts.map((p) => ({
    account: AccountId.fromString(p.accountId),
    tinybars: BigInt(p.netPayoutTinybars),
    amount: Hbar.fromTinybars(BigInt(p.netPayoutTinybars))
  }))

  const totalDeductedTinybars = netLegs.reduce((sum, leg) => sum + leg.tinybars, 0n)
  const totalDeducted = Hbar.fromTinybars(totalDeductedTinybars)

  // Construir la transacción de transferencia atómica multidestino
  let massPayoutTx = new TransferTransaction()
    // Debitar a la tesorería operadora por el monto total
    .addHbarTransfer(operatorId, Hbar.fromTinybars(-totalDeductedTinybars))

  // Acreditar a cada inversor simultáneamente
  for (const leg of netLegs) {
    massPayoutTx = massPayoutTx.addHbarTransfer(leg.account, leg.amount)
  }

  const massPayoutSubmit = await massPayoutTx.freezeWith(client).execute(client)
  const massPayoutReceipt = await massPayoutSubmit.getReceipt(client)

  console.log(`   ✅ Pago Masivo Atómico Liquidado: ${massPayoutReceipt.status.toString()}`)
  console.log(`   🔗 ID de Transacción: ${massPayoutSubmit.transactionId.toString()}`)
  console.log(`   🔗 URL de Hashscan:   ${getHashscanUrl(massPayoutSubmit.transactionId.toString())}\n`)

  // 4. Emitir Certificado de Auditoría Regulatoria de ATS a HCS
  console.log('[4/4] 📜 Anclando Certificado de Auditoría Regulatoria de ATS en Consensus Service...')
  let complianceTopicId = getState('ATS_COMPLIANCE_TOPIC_ID')

  if (!complianceTopicId) {
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('ATS Corporate Actions Compliance Log')
      .execute(client)
    const topicRx = await topicTx.getReceipt(client)
    complianceTopicId = topicRx.topicId.toString()
    updateState('ATS_COMPLIANCE_TOPIC_ID', complianceTopicId)
  }

  const auditPayload = {
    standard: 'ATS-CORPORATE-ACTION-V2',
    actionType: 'DIVIDEND_DISTRIBUTION',
    securityToken: securityTokenSymbol,
    recordConsensusTimestamp: recordTimestamp,
    settlementTransactionId: massPayoutSubmit.transactionId.toString(),
    dividendPoolHbar: Hbar.fromTinybars(distributionPlan.totalBudgetTinybars).toString(),
    netDispersedHbar: totalDeducted.toString(),
    recipientsCount: distributionPlan.payouts.length,
    payoutHash: crypto.createHash('sha256').update(JSON.stringify(distributionPlan)).digest('hex'),
    timestamp: new Date().toISOString()
  }

  const hcsSubmit = await new TopicMessageSubmitTransaction()
    .setTopicId(complianceTopicId)
    .setMessage(JSON.stringify(auditPayload))
    .execute(client)
  const hcsReceipt = await hcsSubmit.getReceipt(client)

  console.log(`   ✅ Certificado de Auditoría Anclado al Topic HCS: ${complianceTopicId}`)
  console.log(`   Número de Secuencia de Consenso: #${hcsReceipt.topicSequenceNumber.toString()}`)
  console.log(`   Hash de la Carga de Auditoría:    ${auditPayload.payoutHash}`)

  // Persistir Estado
  updateState('ATS_LAST_MASS_PAYOUT_TX_ID', massPayoutSubmit.transactionId.toString())
  updateState('ATS_LAST_CORPORATE_ACTION_DATE', auditPayload.timestamp)

  console.log('\n====================================================================')
  console.log('🎉 MOTOR DE PAGOS MASIVOS DE ASSET TOKENIZATION STUDIO: LIQUIDADO Y VERIFICADO')
  console.log('====================================================================')

  client.close()
  process.exit()
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
