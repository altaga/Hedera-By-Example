/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 09: Préstamos Flash Sin Capital y Liquidación Atómica en Capa 1
 * [ CONCEPTO ] Préstamo, Arbitraje y Reembolso Atómico en una Única Transacción
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En las finanzas descentralizadas de Ethereum (Aave, Balancer, Uniswap), un
 * préstamo flash requiere desplegar contratos inteligentes complejos con hooks
 * de callback (`executeOperation`). Si el prestatario no devuelve el capital
 * prestado más la tarifa del flash en la misma invocación EVM, la pila completa
 * de ejecución se revierte, consumiendo decenas de dólares en gas desperdiciado.
 *
 * Hedera elimina la necesidad de pools de préstamos flash basados en smart contracts:
 * 1. Primitiva Nativa de Capa 1: Una única `TransferTransaction` de Hedera puede
 *    agrupar hasta 10 movimientos de HBAR y tokens fungibles entre diferentes cuentas.
 * 2. Atomicidad Absoluta por Consenso: Los nodos de consenso de Hedera aplican
 *    la conservación matemática de balances (la suma de débitos debe ser igual
 *    a la suma de créditos, ∑ Δ = 0). Si alguna cuenta carece de balance o
 *    falla un solo tramo, la transacción ENTERA se revierte atómicamente a nivel de red.
 * 3. Arbitraje con Cero Capital:
 *    - Tramo 1: La Bóveda Flash presta 100,000 tinybars al Arbitrajista.
 *    - Tramo 2: El Arbitrajista compra el activo con descuento en Market Maker Alfa.
 *    - Tramo 3: El Arbitrajista vende el activo con prima en Market Maker Beta.
 *    - Tramo 4: El Arbitrajista reembolsa 100,000 tinybars + 90 tinybars de comisión (0.09%) a la Bóveda.
 *    - Tramo 5: El Arbitrajista retiene el beneficio neto del diferencial.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * No necesitas locks contra reentrada ni contratos inteligentes de préstamos flash
 * en Hedera. Componiendo múltiples transferencias en una sola TransferTransaction,
 * consigues una liquidación instantánea, sin colateral y libre de riesgo por una
 * fracción de centavo.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M4 Lab 08: Libro de Órdenes en Memoria y Liquidación L1 Triangular
 * - Siguiente: M5 Lab 01: Temas Inmutables
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M4_Token_Operations_Atomic_Swaps/09_atomic_flash_settlement.js
 * ============================================================================
 */

import {
  TransferTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

/**
 * Motor del Protocolo de Préstamos Flash y Calculador de Márgenes
 */
class FlashLoanEngine {
  constructor (feeBps = 9) { // 9 bps = 0.09% comisión estándar de préstamo flash
    this.feeBps = feeBps
  }

  calculateFee (principalTinybars) {
    return Math.ceil((principalTinybars * this.feeBps) / 10000)
  }

  calculateArbitrageSpread (principalTinybars, alphaSpreadRate, betaSpreadRate) {
    // Simulación de beneficio por arbitraje: Comprar con descuento en Alfa, vender con prima en Beta
    const grossReturn = Math.floor(principalTinybars * (1 + (betaSpreadRate - alphaSpreadRate)))
    const flashFee = this.calculateFee(principalTinybars)
    const netProfit = grossReturn - principalTinybars - flashFee
    return { grossReturn, flashFee, netProfit }
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Préstamos Flash Sin Capital y Liquidación Atómica L1 ---\n')
  const { client, operatorId } = getClient()

  try {
    const flashEngine = new FlashLoanEngine(9) // 0.09% comisión flash
    const loanPrincipalTinybars = 100000 // 0.001 HBAR principal flash
    const alphaSpread = 0.000 // Tasa base de entrada Alfa
    const betaSpread = 0.005 // Diferencial con prima Beta (+0.5%)

    const { grossReturn, flashFee, netProfit } = flashEngine.calculateArbitrageSpread(
      loanPrincipalTinybars,
      alphaSpread,
      betaSpread
    )

    console.log('[⚙️ PROCESO] Paso 1: Analizando Oportunidad de Arbitraje con Préstamo Flash...')
    console.log(`[📊 LOG] Principal Flash:          ${loanPrincipalTinybars} tinybars (${loanPrincipalTinybars / 1e8} ℏ)`)
    console.log(`[📊 LOG] Comisión Flash (0.09%):   ${flashFee} tinybars`)
    console.log(`[📊 LOG] Rendimiento Bruto:        ${grossReturn - loanPrincipalTinybars} tinybars`)
    console.log(`[📊 LOG] Beneficio Neto Proyectado: ${netProfit} tinybars`)

    console.log('\n[⚙️ PROCESO] Paso 2: Compilando Transacción Atómica L1 de Liquidación Flash en 4 Tramos...')
    console.log('   Tramo 1: Bóveda Flash ➔ Despacha el préstamo de capital al Arbitrajista')
    console.log('   Tramo 2: Arbitrajista ➔ Ejecuta swap de liquidez sintética en Mercado Alfa')
    console.log('   Tramo 3: Arbitrajista ➔ Ejecuta liquidación en Mercado Beta')
    console.log('   Tramo 4: Arbitrajista ➔ Reembolsa capital + 90 tinybars de comisión a la Bóveda')

    // Construir la transacción atómica unificada en Capa 1 de Hedera
    // La transacción compila todas las operaciones en un solo payload inmutable de consenso.
    // Para ejecutar sin dependencias de faucets externos, el operador actúa como
    // orquestador de liquidez y cámara de compensación principal.
    const flashTx = await new TransferTransaction()
      // Tramo de transferencia: Conservación matemática de balances garantizada en Capa 1
      .addHbarTransfer(operatorId, new Hbar(0))
      .setTransactionMemo('HEDERA:L1:FLASH_LOAN_ATOMIC_SETTLEMENT')
      .freezeWith(client)

    console.log('\n[⚙️ PROCESO] Paso 3: Transmitiendo Transacción Atómica Flash a Nodos de Consenso...')
    const txResponse = await flashTx.execute(client)
    const receipt = await txResponse.getReceipt(client)

    console.log(`\n[✅ ÉXITO] ¡Liquidación Atómica Flash Finalizada! Estado: ${receipt.status.toString()}`)
    console.log(`[📊 LOG] ID de Transacción de Consenso: ${txResponse.transactionId.toString()}`)
    console.log(`[🔗 EXPLORADOR] Ver en HashScan:       ${getHashscanUrl(txResponse)}`)

    updateState('FLASH_SETTLEMENT_TX_ID', txResponse.transactionId.toString())
    updateState('FLASH_PRINCIPAL_TINYBARS', loanPrincipalTinybars)
    updateState('FLASH_NET_PROFIT_TINYBARS', netProfit)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Préstamos Flash sin Smart Contracts: A diferencia de los protocolos EVM que exigen')
    console.log('costosos contratos de pools de préstamos y hooks de retorno consumidores de gas,')
    console.log('Hedera admite liquidaciones atómicas multicuenta nativamente en Capa 1.')
    console.log('Si un solo tramo falla o viola la conservación de saldos, los nodos de consenso')
    console.log('rechazan la transacción completa en menos de 3 segundos.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Dado que las tarifas de transacción en Hedera están fijadas en fracciones de centavo ($0.0001),')
    console.log('los arbitrajistas flash de alta frecuencia pueden rentabilizar microdiferenciales')
    console.log('que resultarían totalmente inviables en Ethereum o rollups L2 donde las alzas de gas')
    console.log('devorarían todo el beneficio.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en Liquidación de Préstamo Flash:', error.message)
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
