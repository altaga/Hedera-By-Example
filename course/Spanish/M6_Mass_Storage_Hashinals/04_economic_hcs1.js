/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Almacenamiento Económico con HCS-1 (Hashinals)
 * [CONCEPTO] Fragmentación (Sharding) y Ordenamiento Cronológico como Datos
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Eficiencia Extrema: Mientras que el HFS ofrece disponibilidad garantizada
 * por los nodos, el HCS ofrece "Ordenamiento Justo", que es intrínsecamente
 * más económico. El estándar HCS-1 aprovecha este ordenamiento para simular
 * almacenamiento a gran escala: divide el archivo en fragmentos Base64,
 * los vincula a un hash SHA-256 único y los ancla al consensus en un solo
 * Topic. Esto permite registrar datasets masivos en el ledger por una
 * fracción del costo, ideal para datos de larga duración y alta
 * disponibilidad descentralizada.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El estándar HCS-1 permite inscripciones on-chain altamente económicas: fragmentar archivos en mensajes ordenados de consenso en vez de almacenamiento en smart contracts reduce los costos en un 99%.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M6 Lab 03: Carga Masiva (Bucket)
 * - Actual:   M6 Lab 04: Almacenamiento Económico HCS-1
 * - Siguiente: M6 Lab 05: Reconstrucción de Datos
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 04_economic_hcs1.js
 * ============================================================================
 */

import { TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import crypto from 'crypto'
import { getClient, getHashscanUrl, updateState, show } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

/**
 * Pipeline HCS-1: Fragmenta un buffer en mensajes JSON estandarizados.
 */
const constructHcs1Payloads = (fileBuffer, topicIdStr) => {
  // Calcula el hash: cualquiera puede recalcularlo para verificar los datos.
  const fileHashHex = crypto.createHash('sha256').update(fileBuffer).digest('hex')
  const base64Str = fileBuffer.toString('base64')

  // Límite conservador para asegurar que el JSON completo quepa en el límite de HCS (~1KB sugerido para optimización)
  const MAX_CHUNK_SIZE = 700
  const chunks = []

  for (let i = 0; i < base64Str.length; i += MAX_CHUNK_SIZE) {
    chunks.push(base64Str.slice(i, i + MAX_CHUNK_SIZE))
  }

  return chunks.map((chunk, index) => ({
    h: 'hcs-1', // Identificador del protocolo
    fid: fileHashHex, // Hash de identidad del archivo original
    s: topicIdStr, // Puntero al Topic de consenso
    i: index, // Índice de secuencia del fragmento
    t: chunks.length, // Total de fragmentos para reensamblaje
    d: chunk // Carga útil codificada en Base64
  }))
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Almacenamiento HCS-1 (Hashinals) ---\n')

  const { client } = getClient()

  try {
    const __dirname = path.dirname(import.meta.filename)
    const filePath = path.resolve(__dirname, './assets/largeFile.png')

    if (!fs.existsSync(filePath)) {
      throw new Error(`Recurso masivo no encontrado en ${filePath}`)
    }

    const fileBuffer = fs.readFileSync(filePath)
    console.log(`[INFO] Procesando archivo binario: ${fileBuffer.length} bytes.`)

    // 1. Crear el Topic ancla para HCS-1
    console.log('[PROCESO] Creando Tema de Consenso (Topic) dedicado para HCS-1...')
    // Crea el tópico: un registro de mensajes ordenado y con timestamp; una submit key restringiría quién escribe.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-1 Asset Anchor')
      .freezeWith(client)

    const topicRes = await topicTx.execute(client)
    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const topicReceipt = await topicRes.getReceipt(client)
    const topicId = topicReceipt.topicId

    console.log(`[ÉXITO] Canal de almacenamiento HCS-1 activado: ${topicId.toString()}`)
    console.log(`[REGISTRO] Ver en HashScan: ${getHashscanUrl(topicRes)}`)

    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
    console.log(`[REGISTRO] Huella Digital (SHA-256): ${fileHash}`)

    const payloads = constructHcs1Payloads(fileBuffer, topicId.toString())
    console.log(`[INFO] Archivo fragmentado en ${payloads.length} mensajes compatibles.\n`)

    // 2. Enviar fragmentos (Shards)
    console.log('[PROCESO] Anclando fragmentos al ledger de consenso...')
    for (const payload of payloads) {
      show.shards({ id: 'hcs1-upload', title: 'Fragmentos HCS-1 enviados', total: payload.t, done: payload.i + 1 })
      // Publica: el consenso le da al mensaje un número de secuencia y un timestamp en el que todos coinciden.
      const submitTx = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify(payload))
        .execute(client)

      await submitTx.getReceipt(client)
      console.log(`└─ Fragmento (Shard) ${payload.i + 1}/${payload.t} confirmado.`)
    }

    console.log('\n[ÉXITO] Ciclo de vida de almacenamiento HCS-1 completado.')

    // Persistir el Topic ID para el laboratorio de reconstrucción
    updateState('HCS_TOPIC_ID', topicId.toString())

    console.log('\n CONCEPTO CLAVE:')
    console.log('HCS-1 es el estándar detrás de los "Hashinals". Al usar el')
    console.log('consenso para el ordenamiento, garantizas la integridad de')
    console.log('los datos por una fracción del costo de almacenamiento directo,')
    console.log('permitiendo registrar archivos de gigabytes en el ledger.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] El flujo de almacenamiento HCS-1 falló:', error.message)
    process.exitCode = 1
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
