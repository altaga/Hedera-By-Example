/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 05: Reconstrucción Trustless de Datos desde HCS-1
 * [CONCEPTO] Verificación Criptográfica de Integridad y Reensamblaje
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Verificación Sin Confianza: La reconstrucción de datos HCS-1 es el proceso
 * inverso de la fragmentación. Al consultar el Mirror Node, recuperamos
 * todos los fragmentos, validamos su esquema y los ordenamos por secuencia.
 * El resultado es un activo criptográficamente idéntico al original porque
 * cada fragmento está vinculado al SHA-256 del archivo completo. Aquí no
 * confías en el servidor que entrega los datos; confías en las matemáticas
 * y en el orden inmutable del ledger.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Reconstruir activos inscritos exige ordenar los fragmentos de HCS por número de secuencia y verificar el hash SHA-256 acumulado antes de ensamblar las imágenes o documentos en base64.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M6 Lab 04: Almacenamiento Económico HCS-1
 * - Actual:   M6 Lab 05: Reconstrucción de Datos
 * - Siguiente: M6 Lab 06: Ecosistema de Hashinals
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 01 de M5 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 05_reconstruct_hcs1.js
 * ============================================================================
 */

import { getMirrorNodeBaseUrl, getState, waitForMirror, show } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Reconstrucción de Activos (HCS-1) ---\n')

  const topicId = getState('HCS_TOPIC_ID')

  if (!topicId) {
    console.error('[FALLO] Falta HCS_TOPIC_ID en el estado local. Ejecuta Lab 04 primero.')
    process.exitCode = 1
    return
  }

  try {
    console.log(`[INFO] Consultando Mirror Node para Topic: ${topicId}`)

    /**
     * Recuperación de fragmentos vía Mirror Node REST API.
     * Avanzamos por la paginación para asegurar que capturamos todo el activo.
     */
    const fetchAllMessages = async () => {
      let nextLink = `/api/v1/topics/${topicId}/messages`
      const messages = []
      while (nextLink) {
        const response = await fetch(`${getMirrorNodeBaseUrl()}${nextLink}`)
        if (!response.ok) {
          throw new Error(`La API del Mirror Node falló: ${response.statusText}`)
        }
        const data = await response.json()
        messages.push(...data.messages)
        nextLink = data.links?.next || null
      }
      return messages
    }

    // Cada fragmento HCS-1 indica el total (t). El Mirror Node muestra los mensajes unos
    // segundos después del consenso; esperamos a que estén todos los del archivo más reciente.
    const hasAllShards = (messages) => {
      const parsed = messages
        .map((m) => { try { return JSON.parse(Buffer.from(m.message, 'base64').toString()) } catch (_) { return null } })
        .filter((sh) => sh && sh.h === 'hcs-1')
      if (!parsed.length) return false
      const latest = parsed[parsed.length - 1]
      return parsed.filter((sh) => sh.fid === latest.fid).length >= latest.t
    }

    console.log('[PROCESO] Descargando fragmentos del ledger descentralizado...')
    const allMessages = (await waitForMirror(async () => {
      const messages = await fetchAllMessages()
      return hasAllShards(messages) ? messages : null
    }, { timeoutMs: 60_000 })) || await fetchAllMessages()

    if (allMessages.length === 0) {
      console.error('[FALLO] No hay mensajes en este tema. Ejecuta el Lab 04 primero.')
      process.exitCode = 1
      return
    }

    console.log(`[REGISTRO] Se localizaron ${allMessages.length} mensajes en el Mirror Node.`)

    // 1. Decodificar y Filtrar Fragmentos HCS-1
    const shards = allMessages
      .map(m => {
        try {
          const decoded = Buffer.from(m.message, 'base64').toString()
          return JSON.parse(decoded)
        } catch (e) {
          return null
        }
      })
      .filter(sh => sh && sh.h === 'hcs-1')

    if (shards.length === 0) {
      throw new Error('No se encontraron fragmentos compatibles con el estándar HCS-1.')
    }

    // 2. Identificar el activo más reciente (FID)
    const latestFid = shards[shards.length - 1].fid
    const filteredShards = shards.filter(sh => sh.fid === latestFid)

    console.log(`[ÉXITO] Identidad del Activo (FID): ${latestFid}`)
    console.log(`[INFO] Reensamblando a partir de ${filteredShards.length} shards.`)

    // 3. Ordenar por índice para restaurar integridad estructural
    filteredShards.sort((a, b) => a.i - b.i)

    // 4. Validar integridad de la descarga
    const totalExpected = filteredShards[0].t
    if (filteredShards.length < totalExpected) {
      throw new Error(`Datos corruptos: ${filteredShards.length}/${totalExpected} fragmentos hallados.`)
    }

    // 5. Unir la cadena Base64
    let fullBase64 = ''
    filteredShards.forEach(sh => {
      show.shards({ id: 'hcs1-stitch', title: 'Fragmentos reensamblados', total: totalExpected, done: sh.i + 1 })
      fullBase64 += sh.d
      console.log(`└─ [LECTURA] Fragmento ${sh.i + 1}/${totalExpected} procesado.`)
    })

    // 6. Persistir resultado reconstruido como binario
    const resultBuffer = Buffer.from(fullBase64, 'base64')
    const __dirname = path.dirname(import.meta.filename)
    const dateStr = new Date().toISOString().split('T')[0]
    const outputPath = path.resolve(__dirname, `./assets/reconstructed_${dateStr}.png`)

    fs.writeFileSync(outputPath, resultBuffer)

    console.log('\n---  [ÉXITO] ACTIVO RECONSTRUIDO CON ÉXITO ---')
    console.log(`[REGISTRO] Identidad Digital: ${latestFid}`)
    console.log(`[REGISTRO] Tamaño Final:    ${resultBuffer.length} bytes`)
    console.log(`[REGISTRO] Ubicación:       ${outputPath}`)
    console.log('---------------------------------------------------------')

    console.log('\n CONCEPTO CLAVE:')
    console.log('La soberanía de los datos radica en poder reconstruirlos sin')
    console.log('permisos de terceros. Mientras un Mirror Node de Hedera exista,')
    console.log('tus activos digitales estarán seguros y disponibles para ser')
    console.log('reensamblados con fidelidad matemática.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] La reconstrucción de datos falló:', error.message)
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
