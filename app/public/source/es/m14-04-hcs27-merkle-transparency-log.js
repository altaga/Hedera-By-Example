/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Puntos de Control de Transparencia Merkle HCS-27 y Pruebas Criptográficas
 * [ CONCEPTO ] Lotes Off-Chain Masivos con Raíces Merkle Ancladas al Consenso
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Puntos de Control de Transparencia Escalables: Cuando un agente de IA o empresa
 * procesa decenas de miles de micro-decisiones por minuto, emitir cada una como
 * un mensaje individual on-chain genera sobrecarga innecesaria.
 * HCS-27 establece un estándar de puntos de control auditables: lotes masivos de
 * operaciones se estructuran en un árbol Merkle off-chain, y solo la raíz Merkle
 * determinista se ancla a HCS en cada época.
 * Cualquier operación individual puede demostrarse mediante una prueba de inclusión Merkle compacta.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * Esta es la misma técnica criptográfica empleada por los registros Certificate Transparency (CT)
 * de la web y los rollups de conocimiento cero. Se logra el costo económico de las bases
 * de datos off-chain con la finalidad matemática inquebrantable de Hedera Hashgraph.
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M14 Lab 03: Registro de Habilidades de Agentes HCS-26
 * - Siguiente: M14 Lab 05: Flujo de Auditoría Cognitiva de Agentes HCS-28
 *
 * [ SIMULADO ]
 * Los 64 registros de inferencia son sintéticos. El árbol de Merkle, la prueba y el checkpoint en HCS son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M14_Advanced_HCS_Standards_AI/04_hcs27_merkle_transparency_log.js
 * ============================================================================
 */

import crypto from 'crypto'
import { ethers } from 'ethers'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import {
  buildHCS27TopicMemo,
  buildHCS27TransactionMemo
} from '@hashgraphonline/standards-sdk'
import { getClient, updateState, show } from '../M99_Utilities/index.js'

/**
 * Construye un árbol Merkle a partir de un arreglo de cadenas de datos.
 *
 * @param {Array<string>} rawItems - Arreglo de datos
 * @returns {object} Árbol con capas, hojas y raíz
 */
const buildMerkleTree = (rawItems) => {
  const leafHashes = rawItems.map(item => ethers.keccak256(ethers.toUtf8Bytes(item)))
  const layers = [leafHashes]

  while (layers[layers.length - 1].length > 1) {
    const currentLayer = layers[layers.length - 1]
    const nextLayer = []
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i]
      const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : left
      const combined = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [left, right])
      nextLayer.push(combined)
    }
    layers.push(nextLayer)
  }

  return {
    root: layers[layers.length - 1][0],
    leaves: leafHashes,
    layers
  }
}

/**
 * Genera una prueba de inclusión Merkle para una hoja en un índice determinado.
 *
 * @param {object} tree - Objeto del árbol Merkle
 * @param {number} leafIndex - Índice de la hoja objetivo
 * @returns {Array<object>} Pasos de prueba con nodos hermanos
 */
const getMerkleProof = (tree, leafIndex) => {
  const proof = []
  let index = leafIndex

  for (let i = 0; i < tree.layers.length - 1; i++) {
    const layer = tree.layers[i]
    const isRight = index % 2 === 1
    const siblingIndex = isRight ? index - 1 : index + 1
    const sibling = siblingIndex < layer.length ? layer[siblingIndex] : layer[index]

    proof.push({
      position: isRight ? 'left' : 'right',
      hash: sibling
    })
    index = Math.floor(index / 2)
  }

  return proof
}

/**
 * Verifica una prueba de inclusión Merkle contra una raíz esperada.
 *
 * @param {string} leafHash - Hash del elemento a verificar
 * @param {Array<object>} proof - Pasos de la prueba
 * @param {string} root - Raíz Merkle esperada
 * @returns {boolean} Verdadero si la hoja pertenece a la raíz
 */
const verifyMerkleProof = (leafHash, proof, root) => {
  let computed = leafHash

  for (const step of proof) {
    if (step.position === 'left') {
      computed = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [step.hash, computed])
    } else {
      computed = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [computed, step.hash])
    }
  }

  return computed === root
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Puntos de Control Merkle HCS-27 ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Crear Tópico de Puntos de Control HCS-27
    const topicMemo = buildHCS27TopicMemo()
    console.log(`[⚙️ PROCESO] Creando Tópico de Puntos de Control HCS-27 (Memo: ${topicMemo})...`)
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo(topicMemo)
      .execute(client)

    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[✅ ÉXITO] Tópico HCS-27 Creado: ${topicId}`)

    // 2. Simular 64 Inferencias / Decisiones de IA de Alta Frecuencia Off-Chain
    const batchSize = 64
    console.log(`\n[⚙️ PROCESO] Sintetizando lote de ${batchSize} registros de inferencia de IA off-chain...`)
    const rawInferences = []
    for (let i = 0; i < batchSize; i++) {
      rawInferences.push(JSON.stringify({
        opId: `inf_${i.toString().padStart(4, '0')}`,
        model: 'deepseek-r1-qwen',
        promptTokens: 120 + (i * 3),
        confidence: 0.95 + (i * 0.0005),
        resultHash: crypto.createHash('sha256').update(`inference_payload_${i}`).digest('hex')
      }))
    }

    // 3. Construir Árbol Merkle
    console.log('[⚙️ PROCESO] Construyendo árbol Merkle criptográfico sobre el lote...')
    const merkleTree = buildMerkleTree(rawInferences)
    console.log(`[✅ ÉXITO] ¡Árbol Merkle estructurado en ${merkleTree.layers.length} capas!`)
    console.log(`[📊 REGISTRO] Raíz Merkle Calculada: ${merkleTree.root}`)

    // 4. Ensamblar Punto de Control HCS-27
    const checkpoint = {
      standard: 'hcs-27',
      version: '1.0.0',
      epoch: 108,
      treeSize: batchSize,
      merkleRoot: merkleTree.root,
      operator: operatorId.toString(),
      timestamp: new Date().toISOString()
    }

    console.log('\n[⚙️ PROCESO] Anclando Punto de Control HCS-27 al Consenso de Hedera...')
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setTransactionMemo(buildHCS27TransactionMemo())
      .setMessage(JSON.stringify(checkpoint))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    const seqNum = submitReceipt.topicSequenceNumber.toString()
    console.log(`[✅ ÉXITO] Punto de Control Anclado en Secuencia #${seqNum} en Tópico ${topicId}`)

    // 5. Generar y Verificar Prueba de Inclusión para Inferencia #42
    const targetIndex = 42
    const targetPayload = rawInferences[targetIndex]
    const targetLeafHash = merkleTree.leaves[targetIndex]

    console.log(`\n[⚙️ PROCESO] Generando prueba de inclusión Merkle para la Inferencia #${targetIndex}...`)
    const proof = getMerkleProof(merkleTree, targetIndex)
    show.merkle({ title: 'Prueba de inclusión de Merkle para la inferencia #42', leafCount: merkleTree.leaves.length, leafIndex: targetIndex, root: merkleTree.root, proof: proof.map((p) => p.hash.toString('hex')) })

    console.log(`[📊 REGISTRO] Pasos de Prueba:     ${proof.length} hashes (log2(${batchSize}) = 6 pasos)`)
    console.log(`[📊 REGISTRO] Hash Hoja Objetivo:  ${targetLeafHash}`)

    const isProofValid = verifyMerkleProof(targetLeafHash, proof, merkleTree.root)
    console.log(`\n[📊 AUDITORÍA] Verificación Criptográfica: ${isProofValid ? 'VERIFICADO (100% INCLUIDO)' : 'FRAUDULENTO'}`)

    if (!isProofValid) throw new Error('¡Fallo en la verificación de la prueba Merkle!')

    // Persistir estado
    updateState('HCS27_TOPIC_ID', topicId)
    updateState('HCS27_EPOCH', checkpoint.epoch)
    updateState('HCS27_MERKLE_ROOT', merkleTree.root)
    updateState('HCS27_VERIFIED_LEAF', targetLeafHash)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('HCS-27 ofrece lo mejor de dos mundos: Millones de micro-operaciones corren off-chain')
    console.log('sin saturar la red, mientras un mensaje periódico en HCS establece una verdad')
    console.log('matemática e inquebrantable en Hedera.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Agrupar 10,000 operaciones en una sola raíz Merkle reduce los costos de transacción un 99.99%')
    console.log('manteniendo una auditabilidad jurídica y técnica del 100%.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Fallo en Ejecución de HCS-27:', error.message)
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
