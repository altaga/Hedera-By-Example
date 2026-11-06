/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Oráculo Proof-of-Reserve (PoR) y Disyuntores de Seguridad
 * [CONCEPTO] Atestación de Colateral en Tiempo Real y Prevención de Desanclaje
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Solvencia Criptográfica: Emitir stablecoins u oro tokenizado sin pruebas en tiempo
 * real del colateral subyacente conduce a crisis de insolvencia. Los oráculos de
 * Proof-of-Reserve (PoR) transmiten los saldos de custodia auditados directamente a
 * Hedera. Si el ratio de reservas cae por debajo del 100%, un disyuntor on-chain se
 * activa automáticamente, pausando la emisión hasta restablecer la capitalización.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Para evitar pérdidas de paridad catastróficas, oráculos automáticos de Proof-of-Reserve verifican el colateral bancario antes de permitir emisiones, deteniendo el contrato si las reservas caen del 100%.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/tokenization/stablecoin
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M11 Lab 03: Roles de Stablecoin en HTS (Conceptos de Stablecoin Studio)
 * - Actual:   M11 Lab 04: Oráculo Proof-of-Reserve
 * - Siguiente: M11 Lab 05: Factoraje de Facturas RWA
 *
 * [SIMULADO]
 * Las cifras de reservas del custodio son simuladas. Las reacciones en la red a esas cifras son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~15 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/04_proof_of_reserve_oracle.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

class ProofOfReserveOracle {
  constructor (topicId, targetTokenId) {
    this.topicId = topicId
    this.targetTokenId = targetTokenId
    this.mintingEnabled = true
  }

  evaluateSolvency (onChainSupplyUsd, auditedCustodianBalanceUsd) {
    const collateralRatio = (auditedCustodianBalanceUsd / onChainSupplyUsd) * 100
    const isSolvent = collateralRatio >= 100.0

    if (!isSolvent && this.mintingEnabled) {
      this.mintingEnabled = false
      return {
        solvent: false,
        ratio: collateralRatio.toFixed(2),
        circuitBreakerAction: 'DISYUNTOR_ACTIVADO_PAUSA_EMISION',
        alert: `DÉFICIT CRÍTICO: Reservas al ${collateralRatio.toFixed(2)}%. Emisión detenida.`
      }
    }

    if (isSolvent && !this.mintingEnabled) {
      this.mintingEnabled = true
      return {
        solvent: true,
        ratio: collateralRatio.toFixed(2),
        circuitBreakerAction: 'OPERACIÓN_NORMAL_RESTABLECIDA',
        alert: `RESERVA RESTABLECIDA: Colateral al ${collateralRatio.toFixed(2)}%. Emisión reanudada.`
      }
    }

    return {
      solvent: isSolvent,
      ratio: collateralRatio.toFixed(2),
      circuitBreakerAction: 'MANTENER_ESTADO_ACTUAL',
      alert: 'Solvencia nominal. Reservas saludables.'
    }
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Oráculo de Atestación Proof-of-Reserve (PoR) ---\n')
  const { client, operatorId, network } = getClient()

  try {
    // 1. Crear tópico dedicado de HCS para Atestaciones de Reservas
    console.log('[PROCESO] Inicializando canal de consenso Proof-of-Reserve...')
    // Crea el tópico: un registro de mensajes ordenado y con timestamp; una submit key restringiría quién escribe.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('por:custodian_attestation_feed')
      .freezeWith(client)

    const topicResponse = await topicTx.execute(client)
    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const topicReceipt = await topicResponse.getReceipt(client)
    const porTopicId = topicReceipt.topicId.toString()
    console.log(`[ÉXITO] Tópico de Atestación PoR Creado: ${porTopicId}`)

    const oracle = new ProofOfReserveOracle(porTopicId, '0.0.999123')

    // Escenario A: Sobre-colateralizado (Saludable)
    console.log('\n--- CICLO DE ATESTACIÓN 1: Operación Bancaria Nominal ---')
    const supplyA = 1250000 // $1.25M USDD en circulación
    const custodianA = 1312500 // $1.31M en efectivo en BNY Mellon
    const resultA = oracle.evaluateSolvency(supplyA, custodianA)

    console.log(`[REGISTRO] Suministro On-Chain:  $${supplyA.toLocaleString()} USDD`)
    console.log(`[REGISTRO] Bóveda del Custodio:  $${custodianA.toLocaleString()} USD`)
    console.log(`[REGISTRO] Ratio de Colateral:   ${resultA.ratio}%`)
    console.log(`[REGISTRO] Emisión Permitida:    ${oracle.mintingEnabled ? 'SÍ' : 'NO'}`)

    // Enviar atestación a HCS
    const attestationMsgA = JSON.stringify({
      cycle: 1,
      custodian: 'BNY_MELLON_TRUST',
      tokenSupply: supplyA,
      auditedReserve: custodianA,
      collateralRatio: `${resultA.ratio}%`,
      mintingStatus: oracle.mintingEnabled ? 'ACTIVE' : 'HALTED',
      timestamp: Date.now()
    })

    // Publica: el consenso le da al mensaje un número de secuencia y un timestamp en el que todos coinciden.
    const msgTxA = await new TopicMessageSubmitTransaction()
      .setTopicId(porTopicId)
      .setMessage(attestationMsgA)
      .freezeWith(client)
    await msgTxA.execute(client)
    console.log('[ÉXITO] Atestación 1 Anclada al Consenso de Hedera.')

    // Escenario B: Pánico Bancario / Déficit Repentino (Evento de Estrés)
    console.log('\n--- CICLO DE ATESTACIÓN 2: Caída Repentina de Colateral ---')
    const supplyB = 1250000
    const custodianB = 1050000 // Solo quedan $1.05M (¡Déficit!)
    const resultB = oracle.evaluateSolvency(supplyB, custodianB)

    console.log(`[REGISTRO] Suministro On-Chain:  $${supplyB.toLocaleString()} USDD`)
    console.log(`[REGISTRO] Bóveda del Custodio:  $${custodianB.toLocaleString()} USD`)
    console.log(`[ALERTA] Ratio de Colateral:     ${resultB.ratio}% (< 100%)`)
    console.log(`[ALERTA] Disyuntor de Seguridad: ${resultB.circuitBreakerAction}`)
    console.log(`[ALERTA] Estado de Emisión:      ${oracle.mintingEnabled ? 'ACTIVE' : 'HALTED'}`)

    const attestationMsgB = JSON.stringify({
      cycle: 2,
      custodian: 'BNY_MELLON_TRUST',
      tokenSupply: supplyB,
      auditedReserve: custodianB,
      collateralRatio: `${resultB.ratio}%`,
      mintingStatus: 'HALTED_CIRCUIT_BREAKER',
      timestamp: Date.now()
    })

    const msgTxB = await new TopicMessageSubmitTransaction()
      .setTopicId(porTopicId)
      .setMessage(attestationMsgB)
      .freezeWith(client)
    await msgTxB.execute(client)
    console.log('[ÉXITO] Alerta de Emergencia Anclada al Consenso de Hedera.')

    updateState('POR_TOPIC_ID', porTopicId)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Proof-of-Reserve transforma la transparencia en un sistema de defensa autónomo.')
    console.log('Al transmitir auditorías continuas a HCS, los emisores eliminan el pánico de')
    console.log('corridas bancarias y demuestran solvencia matemática en tiempo real.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en la simulación del oráculo Proof-of-Reserve:', error.message)
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
