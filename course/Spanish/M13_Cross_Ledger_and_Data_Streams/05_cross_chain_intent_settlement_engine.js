/**
 * ============================================================================
 * Lab 05: Motor Autónomo de Liquidación de Intenciones Cross-Chain (CLPR + HIP-336)
 * [CONCEPTO] Router de Liquidez Cross-Ledger Sin Puentes Basado en Intenciones
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Arquitectura Cross-Ledger Basada en Intenciones: Los puentes convencionales
 * exigen bloquear activos en depósitos vulnerables. Con motores de liquidación de intenciones,
 * un usuario o agente simplemente publica una "intención" (ej. "Intercambiar 50 HBAR en Hedera
 * por 100 USDC en Arbitrum"). Un solver descentralizado ejecuta la orden de inmediato usando
 * liquidez local, mientras que la liquidación en Hedera se valida criptográficamente mediante
 * CLPR (HIP-1535) y se ejecuta sin gas para el usuario mediante Tarifas Patrocinadas (HIP-336).
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los usuarios no quieren esperar 20 minutos ni pagar gas en múltiples redes para mover liquidez.
 * Las intenciones trasladan el riesgo al solver profesional, mientras Hedera garantiza la
 * liquidación atómica final en 2.5 segundos con costo de centavos.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-1535
 * - https://github.com/hiero-ledger/hiero-improvement-proposals/blob/main/HIP/hip-336.md
 * - https://eips.ethereum.org/EIPS/eip-7683
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M13 Lab 04: Descubrimiento de Block Nodes y Lago de Datos (HIP-1081 / HIP-1137)
 * - Siguiente: M13 Lab 06: Codificador/Parser Protobuf de Block Stream con los Esquemas HAPI Oficiales
 *
 * [ SECUENCIA ]
 * Trader -> Relayer: Otorgar una asignación de HBAR (HIP-336)
 * Trader -> Hedera: Intención firmada en HCS (comisiones patrocinadas)
 * Relayer -> Otra cadena: Completar la parte externa
 * Nota Relayer: Prueba de estado de la parte externa (CLPR simulado)
 * Relayer -> Hedera: Liquidar la parte de Hedera usando la asignación
 *
 * [ SIMULADO ]
 * La ejecución en Arbitrum y la prueba CLPR son simuladas. La asignación, la intención en HCS y la liquidación en Hedera son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Gastador: ACCOUNT_1 del .env si existe; si no, una cuenta desechable (0.5 ℏ) financiada por el operador.
 * - Costo: ~1 ℏ (comisiones de red y las cuentas que crea).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M13_Cross_Ledger_and_Data_Streams/05_cross_chain_intent_settlement_engine.js
 * ============================================================================
 */

import crypto from 'crypto'
import { ethers } from 'ethers'
import {
  AccountId,
  AccountAllowanceApproveTransaction,
  AccountCreateTransaction,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TransactionId,
  TransferTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, sleep, updateState, createClient, ensureFunded, createLabAccount, parsePrivateKey } from '../M99_Utilities/index.js'

/**
 * Consulta el balance numérico de una cuenta en HBAR mediante el Mirror Node.
 *
 * @param {string} accountId - ID de la cuenta
 * @param {string} network - 'testnet' | 'mainnet'
 * @returns {Promise<number>} Balance en HBAR
 */
const queryBalanceNumber = async (accountId, network = 'testnet') => {
  const res = await fetch(`https://${network}.mirrornode.hedera.com/api/v1/accounts/${accountId}`)
  if (!res.ok) return 0
  const data = await res.json()
  return (data.balance?.balance || 0) / 1e8
}

/**
 * Genera el hash de compromiso de una intención según estándares de solvers cross-chain.
 *
 * @param {object} intent - Especificación de la intención
 * @returns {string} Hash Keccak256 del compromiso
 */
const hashIntent = (intent) => {
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(intent)))
}

const main = async () => {
  console.log('╔═══════════════════════════════════════════════════════════════════════╗')
  console.log('║   MOTOR AUTÓNOMO DE INTENCIONES CROSS-CHAIN (CLPR + HIP-336)        ║')
  console.log('╚═══════════════════════════════════════════════════════════════════════╝\n')

  const { client, operatorId, operatorKey, network } = getClient()
  const solverAccountId = AccountId.fromString(operatorId)
  const solverKey = parsePrivateKey(operatorKey)
  // ACCOUNT_1 del .env si existe; si no, una cuenta desechable financiada por el operador
  const relayer = process.env.ACCOUNT_1_ID && process.env.ACCOUNT_1_PRIVATE_KEY
    ? { accountId: AccountId.fromString(process.env.ACCOUNT_1_ID), privateKey: parsePrivateKey(process.env.ACCOUNT_1_PRIVATE_KEY) }
    : await createLabAccount(client, { hbar: 0.5 })
  const relayerAccountId = relayer.accountId
  const relayerKey = relayer.privateKey

  try {
    // 1. Configurar Actores del Mercado: Trader (0.0000 HBAR), Solver (Patrocinador) y Relayer
    console.log('[PROCESO] Inicializando Actores del Mercado Cross-Chain...')
    const traderKey = PrivateKey.generateED25519()
    const traderCreateTx = await new AccountCreateTransaction()
      .setKeyWithoutAlias(traderKey.publicKey)
      .setInitialBalance(new Hbar(0)) // ¡Trader estrictamente con 0.0000 HBAR!
      .execute(client)

    const traderReceipt = await traderCreateTx.getReceipt(client)
    const traderId = traderReceipt.accountId

    await sleep(3000)
    const initialTraderBal = await queryBalanceNumber(traderId.toString(), network)

    console.log(`[ACTOR] Trader Sin Gas:      ${traderId.toString()} (Balance Inicial: ${initialTraderBal.toFixed(8)} HBAR)`)
    console.log(`[ACTOR] Solver de Liquidez:  ${operatorId.toString()} (Patrocinador y Bóveda)`)
    console.log(`[ACTOR] Relayer Liquidación: ${relayerAccountId.toString()} (Ejecutor de Asignación)`)

    // 2. Delegación de Asignación de Liquidación del Patrocinador (HIP-336)
    console.log('\n[PROCESO] Estableciendo Asignación Delegada de Liquidación HIP-336...')
    const settlementAllowance = new Hbar(2)
    await new AccountAllowanceApproveTransaction()
      .approveHbarAllowance(solverAccountId, relayerAccountId, settlementAllowance)
      .execute(client)
    console.log(`[ÉXITO] ¡Solver otorgó asignación de ${settlementAllowance.toString()} al Relayer (${relayerAccountId.toString()})!`)

    // 3. Definir la Intención Cross-Chain (Firmada por el Trader de 0 HBAR)
    const intentNonce = crypto.randomBytes(12).toString('hex')
    const crossChainIntent = {
      intentId: `intent_0x${intentNonce}`,
      sourceLedger: 'hedera:testnet',
      destinationLedger: 'eip155:42161', // Arbitrum One
      traderSourceAddress: traderId.toString(),
      traderDestAddress: '0x8b3017fbca76428d08cb585ebf9fe31e0730b62e',
      sourceCommitment: { asset: 'HBAR', amount: '0.25' },
      targetFill: { asset: 'USDC', amount: '12.50' },
      expiry: Date.now() + 600000,
      protocol: 'CLPR-INTENT-v1'
    }

    const intentDigest = hashIntent(crossChainIntent)
    console.log('\n[ INTENCIÓN DECLARADA]')
    console.log(`[REGISTRO] ID Intención:        ${crossChainIntent.intentId}`)
    console.log(`[REGISTRO] Ruta:                ${crossChainIntent.sourceLedger} ➔ ${crossChainIntent.destinationLedger}`)
    console.log(`[REGISTRO] Oferta:              ${crossChainIntent.sourceCommitment.amount} ${crossChainIntent.sourceCommitment.asset}`)
    console.log(`[REGISTRO] Expectativa:         ${crossChainIntent.targetFill.amount} ${crossChainIntent.targetFill.asset}`)
    console.log(`[REGISTRO] Hash de Compromiso:  ${intentDigest}`)

    // 4. Anclar la Intención en el Flujo de Consenso de Hedera vía TransactionId Patrocinado
    console.log('\n[PROCESO] Creando Tópico de Libro de Órdenes HCS (con SubmitKey del Trader)...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('INTENT:CLPR:ORDERBOOK')
      .setSubmitKey(traderKey.publicKey)
      .execute(client)
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()

    console.log('[PROCESO] Transmitiendo Intención firmada por el Trader vía TransactionId Patrocinado (0 HBAR Gas)...')
    const sponsoredIntentTx = await new TopicMessageSubmitTransaction()
      .setTransactionId(TransactionId.generate(solverAccountId))
      .setTopicId(topicId)
      .setMessage(JSON.stringify(crossChainIntent))
      .freezeWith(client)

    // Co-firmada por el Trader (autoriza submitKey) y el Solver (paga tarifa de red)
    const traderSignedIntent = await sponsoredIntentTx.sign(traderKey)
    const fullySignedIntent = await traderSignedIntent.sign(solverKey)
    const submitIntentResponse = await fullySignedIntent.execute(client)
    const submitReceipt = await submitIntentResponse.getReceipt(client)
    const consensusSequence = submitReceipt.topicSequenceNumber.toString()
    console.log(`[ÉXITO] Intención Anclada en Secuencia de Consenso #${consensusSequence} en Tópico ${topicId}`)

    // 5. [SIMULACIÓN ARQUITECTÓNICA] El Solver Completa la Orden en Arbitrum y Genera Prueba CLPR (HIP-1535)
    console.log('\n[ EJECUCIÓN DEL SOLVER] [SIMULACIÓN ARQUITECTÓNICA] El solver completa la orden en Arbitrum...')
    const solverFillTxHash = '0x' + crypto.randomBytes(32).toString('hex')
    console.log(`[ÉXITO] ¡Orden simulada completada en Arbitrum! TxHash: ${solverFillTxHash}`)

    console.log('\n[PROCESO] [SIMULACIÓN ARQUITECTÓNICA] Generando Prueba Criptográfica de Estado CLPR (HIP-1535)...')
    const tssValidators = [
      ethers.Wallet.createRandom(),
      ethers.Wallet.createRandom(),
      ethers.Wallet.createRandom()
    ]

    const settlementPayload = ethers.solidityPackedKeccak256(
      ['bytes32', 'bytes32', 'uint64'],
      [intentDigest, solverFillTxHash, Number(consensusSequence)]
    )

    const tssSignatures = tssValidators.map(v => ({
      validator: v.address,
      sig: v.signingKey.sign(settlementPayload).serialized
    }))

    console.log('[ÉXITO] Paquete de Liquidación CLPR Ensamblado:')
    console.log(`[REGISTRO] Resumen de Prueba:   ${settlementPayload}`)
    // Cada firma se comprueba recuperando a su firmante a partir del digest.
    const verifiedSignatures = tssSignatures.filter(({ validator, sig }) => ethers.recoverAddress(settlementPayload, sig) === validator).length
    if (verifiedSignatures < 3) throw new Error(`Solo ${verifiedSignatures}/3 firmas del consejo se verificaron`)
    console.log(`[REGISTRO] Quórum TSS:          ${verifiedSignatures}/3 firmas del consejo verificadas (llaves del consejo simuladas)`)

    // 6. Liquidación Real Delegada en Hedera Testnet
    console.log('\n[PROCESO] Relayer liquidando tramo en Hedera mediante asignación aprobada (`addApprovedHbarTransfer`)...')
    // Aquí ACCOUNT_1 paga las comisiones de sus transacciones; se mantiene con saldo.
    await ensureFunded(client, relayerAccountId, 1)
    const relayerClient = createClient()
    relayerClient.setOperator(relayerAccountId, relayerKey)

    const settlementTx = await new TransferTransaction()
      .addApprovedHbarTransfer(solverAccountId, new Hbar(-0.25)) // Extraído de la asignación aprobada del Solver
      .addHbarTransfer(traderId, new Hbar(0.25)) // Acreditado al Trader en Hedera
      .setTransactionMemo(`CLPR:RESOLVE:${crossChainIntent.intentId}`)
      .execute(relayerClient)
    await settlementTx.getReceipt(relayerClient)
    relayerClient.close()

    console.log(`[ÉXITO] ¡Liquidación Cross-Chain Finalizada en Hedera! Tx: ${settlementTx.transactionId.toString()}`)

    // 7. Panel de Auditoría Posterior a la Ejecución (Medido Dinámicamente desde el Mirror Node)
    await sleep(3500)
    const finalTraderBalNum = await queryBalanceNumber(traderId.toString(), network)
    const finalSolverBalNum = await queryBalanceNumber(operatorId.toString(), network)
    const traderGasSpent = Math.max(0, initialTraderBal - Math.max(0, finalTraderBalNum - 0.25))

    console.log('\n┌────────────────────────────────────────────────────────────────────────┐')
    console.log('│             AUDITORÍA DE LIQUIDACIÓN DE INTENCIONES CROSS-CHAIN        │')
    console.log('├────────────────────────────────────────────────────────────────────────┤')
    console.log('│ Estado de la Intención: LIQUIDADA EN HEDERA (tramo Arbitrum simulado)  │')
    console.log('│ Prueba:                 Prueba TSS estilo CLPR (consejo simulado)      │')
    console.log('│ Mecanismo de Tarifas:   Patrocinio Nativo Delegado (HIP-336)          │')
    console.log(`│ Hash de Destino:        ${solverFillTxHash.slice(0, 22)}... (simulado) │`)
    console.log(`│ Gas Gastado por Trader: ${traderGasSpent.toFixed(8)} HBAR ${traderGasSpent === 0 ? '(100% patrocinado)' : '(no del todo patrocinado)'}             │`)
    console.log(`│ Balance Final Trader:   ${(finalTraderBalNum.toFixed(4) + 'HBAR').padEnd(30)} │`)
    console.log(`│ Balance Final Solver:   ${(finalSolverBalNum.toFixed(4) + 'HBAR').padEnd(30)} │`)
    console.log('└────────────────────────────────────────────────────────────────────────┘')

    // Persistir estado
    updateState('CLPR_ENGINE_INTENT_ID', crossChainIntent.intentId)
    updateState('CLPR_ENGINE_PROOF_DIGEST', settlementPayload)
    updateState('CLPR_ENGINE_SOLVER_TX', solverFillTxHash)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Al combinar pruebas de estado CLPR (HIP-1535) con el asignaciones HIP-336 y tarifas patrocinadas por el pagador,')
    console.log('Hedera se posiciona como el centro de liquidación de mayor rendimiento y menor fricción en Web3.')
    console.log('Cero puentes vulnerables, cero barreras de gas y finalidad en segundos.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Las aplicaciones cross-chain modernas nunca deben exigir al usuario final adquirir tokens exóticos.')
    console.log('Hedera permite abstraer la cadena por completo mediante intenciones y patrocinio nativo.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en el Motor de Liquidación de Intenciones:', error.message)
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
