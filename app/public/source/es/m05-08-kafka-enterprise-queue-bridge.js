/**
 * ============================================================================
 * Lab 08: Puente de Transmisión de Eventos Empresarial (Kafka / Redpanda hacia HCS)
 * [CONCEPTO] Colas Particionadas de Alto Rendimiento y Marcas de Agua Inmutables
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Las arquitecturas empresariales modernas procesan millones de eventos en streaming
 * por segundo mediante intermediarios de logs distribuidos como Apache Kafka, Redpanda o
 * AWS Kinesis. No obstante, los brokers de Kafka son privados, centralizados y
 * vulnerables al truncamiento de registros, manipulación interna o desfase multicloud.
 *
 * El puente empresarial con Hedera Consensus Service (HCS) resuelve esto actuando
 * como anclaje externo y descentralizado de marcas de agua (high-watermarks):
 * 1. Ingesta Particionada Off-Chain: Recibe gigabytes de eventos en tiempo real
 *    en particiones de Kafka con latencias de sub-milisegundo.
 * 2. Commit del Estado de la Marca de Agua: A intervalos periódicos (ej., cada 1,000 eventos
 *    o 10 segundos), los grupos de consumidores calculan un resumen criptográfico
 *    del estado de los offsets de cada partición y los hashes de los payloads.
 * 3. Anclaje de Consenso en HCS: El puente ancla la marca de agua a un tema inmutable
 *    de HCS por el costo de un mensaje. Hedera le asigna una marca de tiempo de consenso justa.
 * 4. Auditoría y Recuperación a Prueba de Manipulaciones: Si una réplica se desincroniza
 *    o enfrenta una auditoría, la empresa puede reproducir los eventos desde el último
 *    anclaje en HCS, demostrando matemáticamente que ningún registro fue alterado o borrado.
 *
 * [ MOMENTO DE APRENDIZAJE ]
 * No es necesario subir cada ping de sensor IoT o paquete de telemetría a la red.
 * Al combinar particiones de streaming empresarial con commits periódicos de marcas
 * de agua en HCS, obtienes el rendimiento de Kafka con la certeza criptográfica de Hedera.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M5 Lab 07: Motor de Ingesta Masiva de Lotes con Árboles Merkle y Pruebas de Inclusión en L1
 * - Siguiente: M6 Lab 01: Almacenamiento Nativo en HFS
 *
 * [ SIMULADO ]
 * No se usa ningún broker Kafka ni Redpanda (un navegador no puede correr uno): las particiones viven en memoria, pero las claves se asignan con el particionador por defecto de Kafka (murmur2), así que cada clave cae en la partición que elegiría un broker real. Los anclajes de marca de agua en HCS son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M5_Hedera_Consensus_Service/08_kafka_enterprise_queue_bridge.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

// Utils.murmur2 de Kafka (org.apache.kafka.common.utils.Utils), con aritmética de enteros de 32 bits.
// Coincide con los vectores de prueba del UtilsTest de Kafka (ej. "21" -> -973932308).
const kafkaMurmur2 = (data) => {
  const m = 0x5bd1e995
  const length = data.length
  let h = (0x9747b28c ^ length) | 0
  for (let i = 0; i < length >> 2; i++) {
    const i4 = i * 4
    let k = (data[i4] & 0xff) | ((data[i4 + 1] & 0xff) << 8) | ((data[i4 + 2] & 0xff) << 16) | ((data[i4 + 3] & 0xff) << 24)
    k = Math.imul(k, m)
    k ^= k >>> 24
    k = Math.imul(k, m)
    h = Math.imul(h, m)
    h ^= k
  }
  const tail = length & ~3
  const rest = length % 4
  if (rest === 3) h ^= (data[tail + 2] & 0xff) << 16
  if (rest >= 2) h ^= (data[tail + 1] & 0xff) << 8
  if (rest >= 1) { h ^= data[tail] & 0xff; h = Math.imul(h, m) }
  h ^= h >>> 13
  h = Math.imul(h, m)
  h ^= h >>> 15
  return h | 0
}

/**
 * Broker de Colas Particionadas en Memoria (Simulación de Kafka / Redpanda)
 */
class InMemoryKafkaBroker {
  constructor (topicName, numPartitions = 2) {
    this.topicName = topicName
    this.numPartitions = numPartitions
    this.partitions = Array.from({ length: numPartitions }, () => [])
  }

  // El particionador por defecto de Kafka: toPositive(murmur2(bytesDeLaClave)) % numPartitions, así
  // un broker real pondría cada clave en la misma partición.
  getPartition (key) {
    return (kafkaMurmur2(Buffer.from(String(key), 'utf8')) & 0x7fffffff) % this.numPartitions
  }

  publish (key, payload) {
    const partitionId = this.getPartition(key)
    const offset = this.partitions[partitionId].length
    const record = {
      offset,
      key,
      payload,
      timestamp: Date.now(),
      hash: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    }
    this.partitions[partitionId].push(record)
    return { partitionId, offset, hash: record.hash }
  }

  getPartitionWatermarks () {
    return this.partitions.map((records, pIdx) => {
      const last = records[records.length - 1]
      return {
        partition: pIdx,
        highWatermarkOffset: records.length - 1,
        totalRecords: records.length,
        latestRecordHash: last ? last.hash : null
      }
    })
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Puente de Cola Empresarial Kafka a Anclaje HCS ---\n')
  const { client } = getClient()

  try {
    // 1. Inicializar Clúster Kafka en Memoria con 2 Particiones
    console.log('[PROCESO] Paso 1: Inicializando Flujo Distribuido Kafka (orders.settlement.v1)...')
    const broker = new InMemoryKafkaBroker('orders.settlement.v1', 2)

    // 2. Ingerir Flujo de Eventos de Alta Velocidad en Particiones
    console.log('[PROCESO] Paso 2: Ingestando Eventos en Tiempo Real de Comercio y Tesorería...')
    const sampleEvents = [
      { key: 'CUST-8812', orderId: 'ORD-901', amount: 450.00, currency: 'USD', status: 'AUTHORIZED' },
      { key: 'CUST-1049', orderId: 'ORD-902', amount: 120.50, currency: 'EUR', status: 'SETTLED' },
      { key: 'CUST-8812', orderId: 'ORD-903', amount: 89.90, currency: 'USD', status: 'CAPTURED' },
      { key: 'CUST-3310', orderId: 'ORD-904', amount: 2400.00, currency: 'USD', status: 'CLEARED' },
      { key: 'CUST-5521', orderId: 'ORD-905', amount: 15.00, currency: 'GBP', status: 'SETTLED' }
    ]

    sampleEvents.forEach(evt => {
      const pub = broker.publish(evt.key, evt)
      console.log(`[KAFKA] Clave: ${evt.key} ➔ Partición [${pub.partitionId}] Offset: ${pub.offset} (SHA: ${pub.hash.substring(0, 10)}...)`)
    })

    // 3. Compilar Marca de Agua de Estado entre Particiones
    console.log('\n[PROCESO] Paso 3: Compilando Marca de Agua de Estado en las Particiones...')
    const watermarks = broker.getPartitionWatermarks()
    const stateHasher = crypto.createHash('sha256')
    watermarks.forEach(w => stateHasher.update(`${w.partition}:${w.highWatermarkOffset}:${w.latestRecordHash}`))
    const clusterStateChecksum = stateHasher.digest('hex')

    const checkpointCommit = {
      standard: 'HCS-KAFKA-ANCHOR-V1',
      stream: 'orders.settlement.v1',
      clusterId: 'kafka-prod-us-east',
      watermarks,
      stateChecksum: clusterStateChecksum,
      committedAt: new Date().toISOString()
    }

    console.log(`[REGISTRO] Total de Particiones:  ${watermarks.length}`)
    console.log(`[REGISTRO] Total de Logs Ingeridos: ${watermarks.reduce((acc, w) => acc + w.totalRecords, 0)}`)
    console.log(`[REGISTRO] Checksum del Estado:   ${clusterStateChecksum}`)

    // 4. Crear Tema de Anclaje HCS en Hedera Testnet
    console.log('\n[PROCESO] Paso 4: Creando Tópico de Consenso de Anclaje HCS...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('KAFKA_ENTERPRISE_ANCHOR_STREAM')
      .execute(client)
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId
    console.log(`[ÉXITO] Tópico de Anclaje HCS Creado: ${topicId.toString()}`)

    // 5. Anclar Checkpoint en la Capa de Consenso de Hedera
    console.log('\n[PROCESO] Paso 5: Anclando Marca de Agua Kafka en Hedera Consensus Service...')
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(checkpointCommit))
      .execute(client)
    const submitReceipt = await submitTx.getReceipt(client)

    console.log(`\n[ÉXITO] ¡Punto de Control Kafka Anclado en HCS! Estado: ${submitReceipt.status.toString()}`)
    console.log(`[REGISTRO] Secuencia de Consenso: #${submitReceipt.topicSequenceNumber.toString()}`)
    console.log(`[REGISTRO] ID de Transacción:      ${submitTx.transactionId.toString()}`)
    console.log(`[EXPLORADOR] Ver en HashScan: ${getHashscanUrl(submitTx)}`)

    updateState('KAFKA_HCS_TOPIC_ID', topicId.toString())
    updateState('KAFKA_LAST_ANCHOR_SEQ', submitReceipt.topicSequenceNumber.toString())
    updateState('KAFKA_STATE_CHECKSUM', clusterStateChecksum)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Arquitectura Empresarial Híbrida: el broker procesa internamente el flujo de alto volumen.')
    console.log('HCS actúa como el tribunal criptográfico de registro. Cualquier auditor puede verificar')
    console.log('que el estado de los offsets en el momento del consenso coincide con el ancla externa.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Al desacoplar el procesamiento de flujos de alta velocidad del anclaje de consenso,')
    console.log('las organizaciones obtienen un rastro de auditoría independiente y con marca de tiempo por el precio de un mensaje HCS por anclaje.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Fallo en la Ejecución del Puente Kafka:', error.message)
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
