/**
 * ============================================================================
 * Lab 04: Oráculo Proof-of-Reserve (PoR) y Disyuntores de Seguridad
 * [CONCEPTO] Atestación de Colateral en Tiempo Real y Prevención de Desanclaje
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Solvencia Criptográfica: emitir stablecoins u oro tokenizado sin una prueba en tiempo real
 * del colateral lleva a crisis de insolvencia. Los feeds de Proof-of-Reserve (PoR) publican en
 * Hedera los saldos auditados del custodio. Si el ratio de reservas cae por debajo del 100%, el
 * oráculo del emisor activa un circuit breaker: en Hedera es una TokenPauseTransaction nativa, y
 * desde ese momento la red rechaza toda operación con el token (emitir, quemar, transferir)
 * hasta que se reanude.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * La pausa la aplica la red, no la app del emisor: con el token pausado, hasta la emisión de la propia tesorería se rechaza con TOKEN_IS_PAUSED. El oráculo solo necesita la llave de pausa del token.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/solutions/tokenization/stablecoin
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M11 Lab 03: Roles de Stablecoin en HTS (Conceptos de Stablecoin Studio)
 * - Siguiente: M11 Lab 05: Pipeline de Factoraje de Facturas con Activos del Mundo Real (RWA)
 *
 * [ SIMULADO ]
 * Las cifras de reservas y suministro son simuladas (un custodio de demostración, no un banco real). El token, la emisión, la pausa, la emisión rechazada, la reanudación y las atestaciones en HCS son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD); <0.1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M11_Hedera_Studios_RWA/04_proof_of_reserve_oracle.js
 * ============================================================================
 */

import {
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenPauseTransaction,
  TokenSupplyType,
  TokenType,
  TokenUnpauseTransaction,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, parsePrivateKey, reuseToken, reuseTopic, updateState } from '../M99_Utilities/index.js'

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
        circuitBreakerAction: 'TRIPPED_EMERGENCY_MINT_PAUSE',
        alert: `DÉFICIT CRÍTICO: reservas al ${collateralRatio.toFixed(2)}%. Emisión detenida.`
      }
    }

    if (isSolvent && !this.mintingEnabled) {
      this.mintingEnabled = true
      return {
        solvent: true,
        ratio: collateralRatio.toFixed(2),
        circuitBreakerAction: 'RESTORED_NORMAL_OPERATIONS',
        alert: `RESERVAS RESTABLECIDAS: colateral al ${collateralRatio.toFixed(2)}%. Emisión reanudada.`
      }
    }

    return {
      solvent: isSolvent,
      ratio: collateralRatio.toFixed(2),
      circuitBreakerAction: 'MAINTAIN_CURRENT_STATE',
      alert: 'Solvencia normal. Reservas sanas.'
    }
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Oráculo de Atestación Proof-of-Reserve (PoR) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const key = parsePrivateKey(operatorKey)
  let tokenId
  let paused = false

  try {
    // 1. La stablecoin (llave de pausa = el circuit breaker del oráculo) y el tópico de atestaciones
    console.log('[PROCESO] Preparando el token respaldado por reservas y el tópico de atestaciones PoR...')
    tokenId = await reuseToken('REUSE_M11_04_TOKEN', async () => {
      const receipt = await (await new TokenCreateTransaction()
        .setTokenName('Reserve-Backed Dollar (course demo)')
        .setTokenSymbol('tRSV')
        .setTokenType(TokenType.FungibleCommon)
        .setDecimals(2)
        .setInitialSupply(0)
        .setSupplyType(TokenSupplyType.Infinite)
        .setTreasuryAccountId(operatorId)
        .setAdminKey(key)
        .setSupplyKey(key)
        .setPauseKey(key)
        .execute(client)).getReceipt(client)
      return receipt.tokenId
    }, { check: (t) => !!t.pause_key })
    const porTopicId = (await reuseTopic('REUSE_M11_04_TOPIC', async () =>
      (await (await new TopicCreateTransaction().setTopicMemo('por:custodian_attestation_feed').execute(client)).getReceipt(client)).topicId
    )).toString()
    console.log(`[ÉXITO] Token ${tokenId} (llave de pausa en manos del oráculo) | Tópico de atestaciones ${porTopicId}`)

    const oracle = new ProofOfReserveOracle(porTopicId, tokenId.toString())
    const attest = async (payload) => {
      const receipt = await (await new TopicMessageSubmitTransaction()
        .setTopicId(porTopicId)
        .setMessage(JSON.stringify({ ...payload, token: tokenId.toString(), custodian: 'DEMO_CUSTODIAN_BANK', timestamp: Date.now() }))
        .execute(client)).getReceipt(client)
      return receipt.topicSequenceNumber.toString()
    }
    const mint = async (units) => (await (await new TokenMintTransaction().setTokenId(tokenId).setAmount(units).execute(client)).getReceipt(client))

    // Ciclo 1: reservas sanas -> el emisor emite
    console.log('\n--- CICLO DE ATESTACIÓN 1: Horario Bancario Normal ---')
    const supplyA = 1250000
    const custodianA = 1312500
    const resultA = oracle.evaluateSolvency(supplyA, custodianA)
    console.log(`[REGISTRO] Suministro: $${supplyA.toLocaleString()} | Bóveda del custodio: $${custodianA.toLocaleString()} | Ratio: ${resultA.ratio}%`)
    const minted = await mint(10000) // 100.00 tRSV
    console.log(`[ÉXITO] Emisión permitida: se emitieron 100.00 tRSV (suministro total ahora ${(Number(minted.totalSupply) / 100).toFixed(2)})`)
    console.log(`[ÉXITO] Atestación 1 anclada en HCS (secuencia #${await attest({ cycle: 1, tokenSupply: supplyA, auditedReserve: custodianA, collateralRatio: `${resultA.ratio}%`, mintingStatus: 'ACTIVE' })})`)

    // Ciclo 2: déficit -> el oráculo pausa el token on-chain
    console.log('\n--- CICLO DE ATESTACIÓN 2: Caída Repentina del Colateral ---')
    const supplyB = 1250000
    const custodianB = 1050000
    const resultB = oracle.evaluateSolvency(supplyB, custodianB)
    console.log(`[ALERTA] Ratio ${resultB.ratio}% (< 100%) -> ${resultB.circuitBreakerAction}`)
    const pauseRes = await new TokenPauseTransaction().setTokenId(tokenId).execute(client)
    await pauseRes.getReceipt(client)
    paused = true
    console.log(`[ÉXITO] Circuit breaker activado on-chain: token ${tokenId} pausado. ${getHashscanUrl(pauseRes)}`)
    let refused = null
    try { await mint(10000) } catch (error) { refused = String(error.status ?? error.message) }
    if (!refused) throw new Error('El token pausado aceptó una emisión')
    console.log(`[VERIFY] La red ahora rechaza la emisión: ${refused}`)
    console.log(`[ÉXITO] Alerta de emergencia anclada en HCS (secuencia #${await attest({ cycle: 2, tokenSupply: supplyB, auditedReserve: custodianB, collateralRatio: `${resultB.ratio}%`, mintingStatus: 'HALTED_CIRCUIT_BREAKER' })})`)

    // Ciclo 3: recapitalizado -> el oráculo reanuda
    console.log('\n--- CICLO DE ATESTACIÓN 3: Reservas Restablecidas ---')
    const custodianC = 1300000
    const resultC = oracle.evaluateSolvency(supplyB, custodianC)
    console.log(`[REGISTRO] Ratio ${resultC.ratio}% -> ${resultC.circuitBreakerAction}`)
    await (await new TokenUnpauseTransaction().setTokenId(tokenId).execute(client)).getReceipt(client)
    paused = false
    console.log(`[ÉXITO] Token ${tokenId} reanudado; se puede volver a emitir.`)
    console.log(`[ÉXITO] Restablecimiento anclado en HCS (secuencia #${await attest({ cycle: 3, tokenSupply: supplyB, auditedReserve: custodianC, collateralRatio: `${resultC.ratio}%`, mintingStatus: 'ACTIVE' })})`)

    updateState('POR_TOPIC_ID', porTopicId)
    updateState('POR_TOKEN_ID', tokenId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('Proof-of-Reserve convierte la transparencia en una defensa automática: las atestaciones')
    console.log('son públicas en HCS, y el circuit breaker es una pausa nativa del token que aplica la red.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló el oráculo de Proof-of-Reserve:', error.message)
    process.exitCode = 1
  } finally {
    // Nunca dejar pausado el token de demostración: la siguiente ejecución tendría que crear otro.
    if (paused) {
      try { await (await new TokenUnpauseTransaction().setTokenId(tokenId).execute(client)).getReceipt(client) } catch (_) {}
    }
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
