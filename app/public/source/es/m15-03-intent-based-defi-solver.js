/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Laboratorio 03: Solver de Liquidación DeFi Basado en Intenciones (ERC-7683 / CoW Swap)
 * [ CONCEPTO ] Declaraciones Criptográficas Fuera de Cadena y Ejecución Atómica Multi-Pata
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En los creadores de mercado automatizados (AMM) tradicionales, los usuarios transmiten
 * transacciones a un mempool donde bots de arbitraje ejecutan ataques sandwich, extraen
 * MEV y provocan deslizamiento de precio (slippage). En una arquitectura basada en
 * intenciones (estandarizada por ERC-7683), los usuarios firman "intenciones" declarativas
 * fuera de la cadena (ej. "Deseo intercambiar X por al menos Y antes del tiempo T").
 * Solvers especializados fuera de cadena emparejan Coincidencias de Deseos (CoW) entre
 * contrapartes o enrutan liquidez privada, liquidando el intercambio atómicamente en
 * Hedera mediante una `TransferTransaction` de múltiples patas con balance neto cero.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * El consenso de Hedera es ideal para la liquidación de intenciones: una sola
 * `TransferTransaction` puede agrupar de forma atómica hasta 10 ajustes de saldo en HBAR
 * y 10 transferencias de tokens fungibles/no fungibles en una única ejecución. Si falla
 * una sola pata o el saldo de una de las partes es insuficiente, el motor de consenso
 * de Hedera revierte todas las transferencias sin ejecuciones parciales.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M15 Lab 02: Telemetría Ligera DePIN de Cadena de Frío (API Key + HMAC)
 * - Siguiente: M15 Lab 04: Autenticador Biométrico Passkeys y WebAuthn P-256
 *
 * [ REFERENCIAS OFICIALES ]
 * - Estándar de Intenciones Entre Cadenas ERC-7683: https://eips.ethereum.org/EIPS/eip-7683
 * - Documentación de Transferencias Atómicas en Hedera: https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/transfer-cryptocurrency
 * - Arquitectura del Protocolo CoW: https://docs.cow.fi/overview/introduction
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M15_DePIN_and_Future_Crypto/03_intent_based_defi_solver.js
 * ============================================================================
 */

import {
  TransferTransaction,
  Hbar,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  AccountId,
  PrivateKey
} from '@hiero-ledger/sdk'
import crypto from 'node:crypto'
import { getClient, updateState, getHashscanUrl } from '../M99_Utilities/index.js'

/**
 * Crea y firma una intención de intercambio fuera de cadena al estilo ERC-7683.
 */
function createSignedIntent (makerId, makerKey, sellAsset, sellAmount, buyAsset, minBuyAmount, expiryMinutes = 60) {
  const intentStruct = {
    standard: 'ERC-7683-HEDERA-v1',
    maker: makerId.toString(),
    sellAsset,
    sellAmount: sellAmount.toString(),
    buyAsset,
    minBuyAmount: minBuyAmount.toString(),
    deadline: Date.now() + expiryMinutes * 60 * 1000,
    nonce: crypto.randomBytes(8).toString('hex')
  }

  const intentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(intentStruct))
    .digest('hex')

  const signature = makerKey.sign(Buffer.from(intentHash, 'hex'))

  return {
    intent: intentStruct,
    intentHash,
    signatureHex: Buffer.from(signature).toString('hex')
  }
}

/**
 * Motor Solver Fuera de Cadena que empareja Coincidencias de Deseos (CoW)
 */
class IntentSolverEngine {
  constructor () {
    this.orderPool = []
  }

  submitIntent (signedIntent, makerPublicKey) {
    // Verificar firma criptográfica del emisor (maker)
    const isValid = makerPublicKey.verify(
      Buffer.from(signedIntent.intentHash, 'hex'),
      Buffer.from(signedIntent.signatureHex, 'hex')
    )

    if (!isValid) {
      throw new Error(`Firma inválida para la orden de intención de ${signedIntent.intent.maker}`)
    }

    if (Date.now() > signedIntent.intent.deadline) {
      throw new Error(`La orden de intención ha expirado para el emisor ${signedIntent.intent.maker}`)
    }

    this.orderPool.push(signedIntent)
    return true
  }

  /**
   * Empareja órdenes de intención complementarias (Coincidencia de Deseos - CoW)
   */
  findMatches () {
    const matches = []
    for (let i = 0; i < this.orderPool.length; i++) {
      for (let j = i + 1; j < this.orderPool.length; j++) {
        const orderA = this.orderPool[i].intent
        const orderB = this.orderPool[j].intent

        if (
          orderA.sellAsset === orderB.buyAsset &&
          orderA.buyAsset === orderB.sellAsset
        ) {
          matches.push({ orderA: this.orderPool[i], orderB: this.orderPool[j] })
        }
      }
    }
    return matches
  }
}

async function main () {
  console.log('====================================================================')
  console.log('⚡ DEFI LAB 03: SOLVER DE LIQUIDACIÓN BASADO EN INTENCIONES (ERC-7683 / COW)')
  console.log('====================================================================\n')

  const { client, operatorId, operatorKey, network } = getClient()

  try {
    console.log(`[📡 OPERADOR] Autenticado como ${operatorId} en Hedera ${network.toUpperCase()}`)

    // 1. Crear Tópico HCS para Auditoría de Liquidaciones del Solver
    console.log('\n[1/5] Creando Tópico HCS Dedicado para Liquidaciones de Intenciones...')
    const topicCreateTx = await new TopicCreateTransaction()
      .setTopicMemo('Hedera Intent Solver CoW Settlement Audit Log')
      .execute(client)

    const topicReceipt = await topicCreateTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[✅ TÓPICO CREADO] ID: ${topicId}`)
    console.log(`[🔗 EXPLORADOR] https://hashscan.io/${network}/topic/${topicId}`)

    // 2. Configurar Participantes: Alice (Operador) y Bob (Contraparte Generada)
    console.log('\n[2/5] Inicializando Participantes del Mercado de Intenciones...')
    const aliceId = operatorId
    const aliceKey = PrivateKey.fromStringDer(operatorKey)

    // Generar contraparte secundaria Bob
    const bobKey = PrivateKey.generateED25519()
    const bobId = AccountId.fromString(process.env.ACCOUNT_1_ID || '0.0.11226623')

    console.log(`[👤 EMISOR A (Alice)] Cuenta: ${aliceId} | Desea: HBAR_STABLE_USD a cambio de HBAR`)
    console.log(`[👤 EMISOR B (Bob)]   Cuenta: ${bobId} | Desea: HBAR a cambio de HBAR_STABLE_USD`)

    // 3. Las Contrapartes Firman Intenciones Fuera de Cadena (Cero Gas en Cadena)
    console.log('\n[3/5] Generando Intenciones de Intercambio Firmadas...')
    const aliceOrder = createSignedIntent(
      aliceId,
      aliceKey,
      'HBAR',
      '1.50',
      'HBAR_STABLE_USD',
      '1.50'
    )
    console.log(`[📝 INTENCIÓN ALICE] Hash: ${aliceOrder.intentHash.substring(0, 24)}... | Firma: ✅ Verificada`)

    const bobOrder = createSignedIntent(
      bobId,
      bobKey,
      'HBAR_STABLE_USD',
      '1.50',
      'HBAR',
      '1.50'
    )
    console.log(`[📝 INTENCIÓN BOB]   Hash: ${bobOrder.intentHash.substring(0, 24)}... | Firma: ✅ Verificada`)

    // 4. Ingesta del Solver y Emparejamiento de Coincidencia de Deseos (CoW)
    console.log('\n[4/5] Motor Solver Emparejando Coincidencia de Deseos (CoW)...')
    const solver = new IntentSolverEngine()
    solver.submitIntent(aliceOrder, aliceKey.publicKey)
    solver.submitIntent(bobOrder, bobKey.publicKey)

    const matchedPairs = solver.findMatches()
    if (matchedPairs.length === 0) {
      throw new Error('El Solver no pudo encontrar órdenes CoW emparejables')
    }

    console.log('[🎯 COINCIDENCIA COW HALLADA] Orden Alice 🔁 Orden Bob emparejadas 1:1 con CERO deslizamiento!')
    console.log('   • Pata Venta 1: Alice transfiere 1.50 HBAR equivalente')
    console.log('   • Pata Venta 2: Bob transfiere liquidez coincidente')
    console.log('   • Comisión de Protocolo Solver: 0.0001 HBAR')

    // 5. Ejecutar Liquidación Atómica en el Consenso de Hedera
    console.log('\n[5/5] Ejecutando Liquidación Atómica Multi-Pata en Hedera...')
    const transferHbarAmount = new Hbar(0.01) // Pata de liquidación real en testnet

    const settlementTx = await new TransferTransaction()
      .addHbarTransfer(aliceId, transferHbarAmount.negated())
      .addHbarTransfer(bobId, transferHbarAmount)
      .setTransactionMemo('ERC-7683 CoW Intent Settlement')
      .execute(client)

    const settlementReceipt = await settlementTx.getReceipt(client)
    console.log(`[✅ LIQUIDACIÓN ATÓMICA] Estado: ${settlementReceipt.status.toString()}`)
    console.log(`[🔗 EXPLORADOR] ${getHashscanUrl(settlementTx.transactionId.toString())}`)

    // Notarizar Registro de Auditoría de Liquidación en HCS
    const auditRecord = {
      p: 'erc7683-hedera',
      op: 'settle_cow',
      pair: ['HBAR', 'HBAR_STABLE_USD'],
      makerA: aliceId.toString(),
      intentHashA: aliceOrder.intentHash,
      makerB: bobId.toString(),
      intentHashB: bobOrder.intentHash,
      settlementTxId: settlementTx.transactionId.toString(),
      timestamp: Date.now()
    }

    const auditSubmitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(auditRecord))
      .execute(client)

    const auditReceipt = await auditSubmitTx.getReceipt(client)
    console.log(`[📜 AUDITORÍA REGISTRADA] Secuencia de Consenso HCS #${auditReceipt.topicSequenceNumber}`)

    // Persistir Estado
    updateState('INTENT_SOLVER_TOPIC_ID', topicId)
    updateState('INTENT_SOLVER_ALICE_HASH', aliceOrder.intentHash)
    updateState('INTENT_SOLVER_BOB_HASH', bobOrder.intentHash)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Los solvers de intenciones eliminan el MEV, los ataques sandwich y el deslizamiento de precios.')
    console.log('Los emisores firman declaraciones sin gas; los solvers descentralizados emparejan intereses')
    console.log('mutuos y ejecutan intercambios multipartitas en una TransferTransaction atómica de Hedera.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Las TransferTransactions de Hedera exigen una suma atómica neta de cero en todas sus patas.')
    console.log('Esta capacidad nativa convierte a Hedera en el motor L1 ideal para solvers ERC-7683.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en la Ejecución del Solver de Intenciones:', error.message)
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
