/**
 * ============================================================================
 * Lab 07: Motor de Ingesta Masiva de Lotes con Árboles Merkle y Pruebas de Inclusión en L1
 * [CONCEPTO] Compresión de Flujos Masivos de Eventos en Anclajes de Consenso Sub-Centavo
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * En arquitecturas empresariales (telemetría IoT, trazabilidad logística, auditoría
 * fintech de alta velocidad), enviar miles de transacciones individuales por segundo
 * a cualquier red genera cuellos de botella de procesamiento y costos elevados.
 * El patrón de Ingesta Masiva con Árboles Merkle permite escalabilidad infinita:
 * 1. Ingesta de Eventos Off-Chain: Los microservicios almacenan eventos en memoria.
 * 2. Cálculo de Raíz Merkle: El motor agrupa los eventos en un Árbol Merkle binario
 *    Keccak-256 y calcula una raíz criptográfica compacta de 32 bytes.
 * 3. Anclaje en HCS: El motor asienta ÚNICAMENTE la raíz Merkle en un Tópico de HCS.
 *    Hedera certifica la estampa de tiempo inmutable de red sobre todo el lote por $0.0001.
 * 4. Prueba de Inclusión Logarítmica: Un cliente ligero con un solo evento puede verificar
 *    que su registro fue certificado en Hedera mediante una rama Merkle compacta O(log N)
 *    sin descargar el resto del conjunto de datos.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * El consenso es el ancla de la verdad criptográfica, no un vertedero de almacenamiento
 * masivo. Mover la verificación de secuencias fuera de cadena mientras se asientan raíces
 * Merkle en HCS permite a empresas procesar más de 100,000 ops/seg a costos sub-centavo.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M5 Lab 06: Tópicos Monetizados Generadores de Ingresos en HBAR y HTS (HIP-991)
 * - Siguiente: M5 Lab 08: Puente de Transmisión de Eventos Empresarial (Kafka / Redpanda hacia HCS)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M5_Hedera_Consensus_Service/07_high_throughput_merkle_batcher.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState, show } from '../M99_Utilities/index.js'

/**
 * Generador y Verificador de Árboles Merkle en Memoria de Alto Rendimiento
 */
class MerkleTreeEngine {
  constructor (leaves) {
    this.leaves = leaves.map(l => (typeof l === 'string' && l.startsWith('0x') ? l : ethers.keccak256(ethers.toUtf8Bytes(l))))
    this.layers = [this.leaves]
    this.buildTree()
  }

  buildTree () {
    let current = this.leaves
    while (current.length > 1) {
      const next = []
      for (let i = 0; i < current.length; i += 2) {
        const left = current[i]
        const right = i + 1 < current.length ? current[i + 1] : left
        const combined = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [left, right])
        next.push(combined)
      }
      this.layers.push(next)
      current = next
    }
  }

  getRoot () {
    return this.layers[this.layers.length - 1][0]
  }

  getProof (leafIndex) {
    const proof = []
    let index = leafIndex
    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i]
      const isRight = index % 2 === 1
      const pairIndex = isRight ? index - 1 : (index + 1 < layer.length ? index + 1 : index)
      proof.push({
        position: isRight ? 'left' : 'right',
        hash: layer[pairIndex]
      })
      index = Math.floor(index / 2)
    }
    return proof
  }

  static verifyProof (leaf, proof, expectedRoot) {
    let currentHash = typeof leaf === 'string' && leaf.startsWith('0x') ? leaf : ethers.keccak256(ethers.toUtf8Bytes(leaf))
    for (const step of proof) {
      if (step.position === 'left') {
        currentHash = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [step.hash, currentHash])
      } else {
        currentHash = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [currentHash, step.hash])
      }
    }
    return currentHash.toLowerCase() === expectedRoot.toLowerCase()
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Motor de Ingesta Masiva con Árboles Merkle (HCS) ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Desplegar un Tópico de Auditoría HCS
    console.log('[PROCESO] Paso 1: Desplegando Tópico de Auditoría Inmutable en HCS...')
    // Crea el tópico: un registro de mensajes ordenado y con timestamp; una submit key restringiría quién escribe.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('ENTERPRISE:MERKLE_BATCH_ANCHOR:V1')
      .execute(client)

    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId
    console.log(`[ÉXITO] Tópico Ancla HCS Creado: ${topicId.toString()}`)

    // 2. Simular Flujo de Telemetría Masiva (1,024 Registros de Alta Frecuencia)
    const BATCH_SIZE = 1024
    console.log(`\n[PROCESO] Paso 2: Ingestando Flujo de ${BATCH_SIZE} Registros en Memoria...`)
    const rawEvents = []
    const sampleTargetIndex = 427

    for (let i = 0; i < BATCH_SIZE; i++) {
      rawEvents.push(JSON.stringify({
        seq: i + 1,
        source: `sensor-node-${(i % 16) + 1}`,
        metric: 'temperature_celsius',
        value: 20 + ((i * 17) % 150) / 10,
        ts: Date.now() - (BATCH_SIZE - i) * 10
      }))
    }
    console.log(`[REGISTRO] Búfer de ingesta lleno: ${rawEvents.length} paquetes de telemetría procesados.`)
    console.log(`[OBJETIVO] Designando Evento de Auditoría #${sampleTargetIndex}:`)
    console.log(`${rawEvents[sampleTargetIndex]}`)

    // 3. Calcular Árbol Merkle Criptográfico
    console.log('\n[PROCESO] Paso 3: Calculando Árbol Merkle Binario Keccak-256...')
    const merkleEngine = new MerkleTreeEngine(rawEvents)
    const merkleRoot = merkleEngine.getRoot()
    console.log(`[ RAÍZ CRIPTO] Raíz Merkle del Lote: ${merkleRoot}`)
    console.log(`[MÉTRICAS] Profundidad: ${merkleEngine.layers.length} niveles | Hojas: ${BATCH_SIZE}`)

    // 4. Anclar la Raíz Merkle a HCS
    console.log('\n[PROCESO] Paso 4: Anclando Compromiso de Raíz Merkle a la Capa de Consenso...')
    const anchorPayload = {
      protocol: 'hcs-merkle-batch-v1',
      merkle_root: merkleRoot,
      batch_size: BATCH_SIZE,
      batch_id: 'BATCH-2026-OCT-8842',
      operator: operatorId.toString(),
      anchored_at: new Date().toISOString()
    }

    // Publica: el consenso le da al mensaje un número de secuencia y un timestamp en el que todos coinciden.
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(anchorPayload))
      .setTransactionMemo('HCS:BATCH_ROOT_COMMIT')
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    console.log(`[ÉXITO] ¡Raíz Merkle Anclada en Secuencia de Consenso #${submitReceipt.topicSequenceNumber}!`)
    console.log('[EFICIENCIA] 1,024 Eventos Certificados en 1 Transacción (~$0.0001 tarifa total)')

    // 5. Generar y Verificar Prueba de Inclusión para el Evento Objetivo
    console.log(`\n[PROCESO] Paso 5: Generando Prueba de Inclusión Compacta O(log N) para Evento #${sampleTargetIndex}...`)
    const inclusionProof = merkleEngine.getProof(sampleTargetIndex)
    console.log(`[COMPRESIÓN] Tamaño de Prueba: ¡Solo ${inclusionProof.length} hashes de 32 bytes para ${BATCH_SIZE} eventos!`)

    console.log('[PROCESO] Verificación Independiente del Cliente Ligero:')
    const isValid = MerkleTreeEngine.verifyProof(rawEvents[sampleTargetIndex], inclusionProof, merkleRoot)
    show.merkle({ title: 'Prueba de inclusión de un evento del lote', leafCount: rawEvents.length, leafIndex: sampleTargetIndex, root: merkleRoot, proof: inclusionProof.map((p) => p.hash.toString('hex')) })
    console.log(`[ PRUEBA CRIPTO] Resultado de Verificación: ${isValid ? 'VÁLIDA (Coincidencia Criptográfica)' : 'RECHAZADA'}`)

    updateState('MERKLE_BATCH_TOPIC_ID', topicId.toString())
    updateState('MERKLE_BATCH_ROOT', merkleRoot)
    updateState('MERKLE_BATCH_SIZE', BATCH_SIZE.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('El Motor de Ingesta Masiva con Árboles Merkle permite escalabilidad horizontal infinita.')
    console.log('Al asentar una sola raíz Merkle Keccak-256 en HCS, miles de eventos heredan el')
    console.log('sellado de tiempo inmutable y ordenamiento justo del consenso de Hedera.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Los clientes externos solo requieren una rama logarítmica O(log N) (10 hashes para 1,024 eventos)')
    console.log('para demostrar matemáticamente su inclusión inalterable ante el registro público de consenso.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[ERROR] Fallo en Motor Merkle Batcher:', error.message)
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
