/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: HFS Nativo — Archivos Grandes (Patrón Anchor + Append)
 * [ CONCEPTO ] Carga Fragmentada y Expansión de Estado
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Superando Límites Físicos: El ledger de Hedera limita el contenido de una
 * sola transacción a ~4-6KB. Para cargar archivos grandes (como modelos de
 * IA, contratos legales complejos o imágenes de alta resolución), se utiliza
 * el patrón "Anchor and Append" (Ancla y Adjuntar). Primero se crea la
 * identidad del archivo (File ID) con los bytes iniciales y luego se
 * transmiten fragmentos sucesivos para expandir su contenido de forma
 * incremental y atómica.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Almacenar archivos más grandes en HFS requiere llamadas secuenciales con FileAppendTransaction. Monitorea los offsets de bytes restantes y las comisiones al anexar bytecodes de smart contracts de varios megabytes.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/file-service/append-to-a-file
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M6 Lab 01: Almacenamiento Nativo HFS
 * - Actual:   M6 Lab 02: Gestión de Archivos Grandes
 * - Siguiente: M6 Lab 03: Carga Masiva (Bucket)
 *
 * [ CÓMO EJECUTAR ]
 * node 02_large_file_hfs.js
 * ============================================================================
 */

import {
  PrivateKey,
  FileCreateTransaction, FileAppendTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Carga Masiva Fragmentada (HFS) ---\n')

  const { client, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    const __dirname = path.dirname(import.meta.filename)
    const filePath = path.resolve(__dirname, './assets/largeFile.png')

    if (!fs.existsSync(filePath)) {
      throw new Error(`Recurso masivo no encontrado en ${filePath}.`)
    }

    const fileBuffer = fs.readFileSync(filePath)
    console.log(`[ℹ️ INFO] Archivo detectado: "${path.basename(filePath)}" (${fileBuffer.length} bytes)`)

    // 1. CREAR EL ARCHIVO (Fragmento Inicial / Ancla)
    const CHUNK_SIZE = 4096 // Límite seguro por transacción en HFS
    const initialChunk = fileBuffer.slice(0, CHUNK_SIZE)

    console.log(`[⚙️ PROCESO] Inicializando ancla de identidad HFS con ${initialChunk.length} bytes...`)
    const createTx = await new FileCreateTransaction()
      .setKeys([adminKey.publicKey])
      .setContents(initialChunk)
      .freezeWith(client)

    const createRes = await createTx.execute(client)
    const createReceipt = await createRes.getReceipt(client)
    const fileId = createReceipt.fileId

    console.log(`[✅ ÉXITO] Ancla de Archivo Creada: ${fileId.toString()}`)

    // 2. ADJUNTAR BYTES RESTANTES (APPEND)
    console.log('[⚙️ PROCESO] Iniciando flujo de expansión de datos (Append)...')
    for (let i = CHUNK_SIZE; i < fileBuffer.length; i += CHUNK_SIZE) {
      const chunk = fileBuffer.slice(i, i + CHUNK_SIZE)

      const appendTx = await new FileAppendTransaction()
        .setFileId(fileId)
        .setContents(chunk)
        .freezeWith(client)

      const appendRes = await appendTx.execute(client)
      await appendRes.getReceipt(client)
      console.log(`   └─ Fragmento ${i} al ${i + chunk.length} anclado exitosamente.`)
    }

    console.log(`\n[✅ ÉXITO] Carga de archivo completa: ${fileId.toString()}`)
    console.log(`[📊 REGISTRO] Ver transacción inicial: ${getHashscanUrl(createRes)}`)

    // Sincronizar para uso en laboratorios posteriores
    updateState('HFS_FILE_ID', fileId.toString())

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Este patrón es aplicable a cualquier dato persistente que supere')
    console.log('el límite de la red. Al usar un solo File ID para múltiples')
    console.log('transacciones, mantienes la integridad de la información bajo')
    console.log('un único identificador global e inmutable.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La carga fragmentada HFS falló:', error.message)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ FALLO] Error de Ejecución:', error.message)
    process.exit(1)
  })
}
