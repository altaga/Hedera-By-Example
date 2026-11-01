/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Puntuación de Confianza de IA HCS-25 y Metodología de Atestación
 * [ CONCEPTO ] Vector de Reputación Descentralizado para Agentes Autónomos
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Reputación Portable de IA: A medida que los agentes autónomos administran capital,
 * ejecutan intercambios e interactúan con APIs, los protocolos necesitan un mecanismo
 * inalterable para evaluar la fiabilidad del agente. HCS-25 define una puntuación de confianza
 * multidimensional calculada a partir de: (1) Pruebas de actividad y tiempo en línea (uptime),
 * (2) Precisión de ejecución determinista en consenso, y (3) Calificaciones humanas / de usuarios
 * firmadas criptográficamente. La puntuación resultante se atesta en HCS y es portable a cualquier
 * blockchain o enjambre de IA.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * La reputación de la IA en Web2 reside en bases de datos opacas (como reseñas de tiendas de apps).
 * Si un agente alucina o incumple un acuerdo de liquidación, su puntuación HCS-25 se degrada
 * permanentemente en el ledger público, alertando y protegiendo a todo el ecosistema.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 01: Puntos Auditables HCS-20
 * - Siguiente: M14 Lab 03: Registro de Habilidades de Agentes HCS-26
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/02_hcs25_ai_trust_score.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Calcula la puntuación de confianza compuesta determinista según HCS-25.
 *
 * @param {object} metrics - Componentes vectoriales (0.00 a 1.00)
 * @returns {number} Puntuación de 0 a 100
 */
const calculateHCS25Score = ({ uptimeRatio, consensusAccuracy, humanFeedbackScore }) => {
  // Metodología ponderada: 35% Disponibilidad, 45% Precisión de Consenso, 20% Calificación Humana
  const weighted = (uptimeRatio * 0.35) + (consensusAccuracy * 0.45) + (humanFeedbackScore * 0.20)
  return Math.round(weighted * 100 * 100) / 100
}

/**
 * Ensambla un documento de atestación HCS-25 con firmas criptográficas de evaluadores independientes.
 *
 * @param {object} params - Identidad del agente, métricas y llaves de evaluadores
 * @returns {object} Documento de atestación
 */
const createHCS25Attestation = ({ agentAccountId, epochNumber, metrics, evaluators }) => {
  const score = calculateHCS25Score(metrics)
  const timestamp = new Date().toISOString()

  const attestationCore = {
    standard: 'hcs-25',
    version: '1.0.0',
    agentId: agentAccountId,
    epoch: epochNumber,
    timestamp,
    metrics: {
      uptimeRatio: metrics.uptimeRatio,
      consensusAccuracy: metrics.consensusAccuracy,
      humanFeedbackScore: metrics.humanFeedbackScore
    },
    compositeScore: score,
    trustTier: score >= 90 ? 'TIER_1_SOVEREIGN' : score >= 75 ? 'TIER_2_VERIFIED' : 'TIER_3_PROBATIONARY'
  }

  const documentHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(attestationCore)))

  // Los evaluadores firman el documento de puntuación
  const endorsements = evaluators.map(ev => {
    const wallet = new ethers.Wallet(ev.privateKey)
    return {
      evaluatorId: ev.evaluatorId,
      publicKey: wallet.address,
      signature: wallet.signingKey.sign(documentHash).serialized
    }
  })

  return {
    ...attestationCore,
    documentHash,
    endorsements
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Puntuación de Confianza de IA HCS-25 ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Crear Tópico de Registro HCS-25
    console.log('[⚙️ PROCESO] Inicializando Tópico de Registro de Reputación HCS-25...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-25:AI:TRUST:REGISTRY')
      .setMaxTransactionFee(new Hbar(2))
      .execute(client)

    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[✅ ÉXITO] Tópico de Registro HCS-25 Creado: ${topicId}`)

    // 2. Definir Agente Autónomo y Métricas de Rendimiento
    const targetAgentId = '0.0.8707881'
    const agentMetrics = {
      uptimeRatio: 0.994, // 99.4% disponibilidad observada
      consensusAccuracy: 0.982, // 98.2% exactitud en consensos deterministas
      humanFeedbackScore: 0.940 // 94.0% satisfacción en retroalimentación humana
    }

    console.log(`\n[⚙️ PROCESO] Evaluando métricas para el Agente Objetivo (${targetAgentId}):`)
    console.log(`[📊 REGISTRO] Ratio de Disponibilidad:   ${(agentMetrics.uptimeRatio * 100).toFixed(2)}%`)
    console.log(`[📊 REGISTRO] Precisión de Consenso:    ${(agentMetrics.consensusAccuracy * 100).toFixed(2)}%`)
    console.log(`[📊 REGISTRO] Calificación Humana:     ${(agentMetrics.humanFeedbackScore * 100).toFixed(2)}%`)

    // 3. Quórum de Evaluadores Firma la Atestación
    const evaluators = [
      { evaluatorId: 'auditor-alpha-sec', privateKey: '0x1111111111111111111111111111111111111111111111111111111111111111' },
      { evaluatorId: 'auditor-hashgraph-dao', privateKey: '0x2222222222222222222222222222222222222222222222222222222222222222' }
    ]

    console.log('\n[⚙️ PROCESO] Compilando documento de atestación multi-firma HCS-25...')
    const attestation = createHCS25Attestation({
      agentAccountId: targetAgentId,
      epochNumber: 42,
      metrics: agentMetrics,
      evaluators
    })

    console.log(`[✅ ÉXITO] Puntuación Compuesta Calculada: ${attestation.compositeScore} / 100`)
    console.log(`[📊 REGISTRO] Nivel de Confianza:    ${attestation.trustTier}`)
    console.log(`[📊 REGISTRO] Hash del Documento:    ${attestation.documentHash}`)
    console.log(`[📊 REGISTRO] Firmas de Respaldo:    ${attestation.endorsements.length} firmas independientes`)

    // 4. Anclar Atestación al Flujo de Consenso de Hedera
    console.log('\n[⚙️ PROCESO] Transmitiendo Atestación HCS-25 al Consenso de Hedera...')
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(attestation))
      .setMaxTransactionFee(new Hbar(2))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    const seqNum = submitReceipt.topicSequenceNumber.toString()
    console.log(`[✅ ÉXITO] ¡Atestación Anclada! Secuencia de Consenso #${seqNum}`)

    // 5. Verificación Criptográfica contra el Padrón Autorizado de Evaluadores
    const authorizedRoster = new Set(
      evaluators.map(ev => new ethers.Wallet(ev.privateKey).address.toLowerCase())
    )
    let validSigs = 0
    for (const end of attestation.endorsements) {
      const recovered = ethers.recoverAddress(attestation.documentHash, end.signature).toLowerCase()
      if (authorizedRoster.has(recovered) && recovered === end.publicKey.toLowerCase()) {
        validSigs++
      }
    }

    console.log(`\n[📊 AUDITORÍA] Verificación Criptográfica: ${validSigs}/${attestation.endorsements.length} Firmas VÁLIDAS`)

    // Persistir estado
    updateState('HCS25_TOPIC_ID', topicId)
    updateState('HCS25_AGENT_ID', targetAgentId)
    updateState('HCS25_COMPOSITE_SCORE', attestation.compositeScore)
    updateState('HCS25_TRUST_TIER', attestation.trustTier)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Bajo HCS-25, la solvencia y fiabilidad de un agente es un hecho verificable on-chain.')
    console.log('Protocolos de préstamos, exchanges automatizados y otros agentes pueden consultar')
    console.log(`el Tópico ${topicId} para definir ratios de colateral y límites de crédito dinámicamente.`)

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Sin una capa de reputación criptográfica, la economía de agentes de IA se colapsaría por fraude.')
    console.log('Hedera Consensus Service actúa como la agencia de calificación crediticia imparcial de Web3.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en Ejecución de HCS-25:', error.message)
    process.exit(1)
  } finally {
    client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ ERROR] Error de Ejecución:', error.message)
    process.exit(1)
  })
}
