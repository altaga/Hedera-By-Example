/**
 * ============================================================================
 * Lab 03: Carga por Lotes Multi-Activo (Manifiestos Compuestos)
 * [CONCEPTO] Bundling On-Chain y Empaquetado Inmuntable
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Un Solo Registro: En lugar de crear un File ID independiente por cada
 * activo binario, este patrón empaqueta múltiples archivos (imágenes,
 * JSON, scripts) en un único registro de HFS usando un "Manifiesto". Al
 * delimitar los archivos con metadatos internos, creas un "Bundle" inmutable
 * (similar a un .zip on-chain). Esta es la arquitectura base de las
 * dApps que almacenan toda su interfaz de usuario (HTML/CSS/JS) en un
 * único identificador global e indestructible.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Agrupar adiciones de archivos por lotes con tamaños de fragmento deterministas evita el rechazo por exceso de tamaño y maximiza el rendimiento de la red durante cargas masivas de activos.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/file-service/append-to-a-file
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M6 Lab 02: Gestión de Archivos Grandes
 * - Actual:   M6 Lab 03: Carga Masiva (Bucket)
 * - Siguiente: M6 Lab 04: Almacenamiento Económico HCS-1
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 01 de M6 (este lab lee lo que guardó).
 * - Costo: ~9 ℏ en cada ejecución (sube un archivo, cerca de 0.5 USD).
 *
 * [ CÓMO EJECUTAR ]
 * node 03_batch_uploading.js
 * ============================================================================
 */

import { FileAppendTransaction, FileId } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Empaquetado de Activos (Bundling) ---\n')

  const { client } = getClient()
  const fileId = getState('HFS_FILE_ID')

  if (!fileId) {
    console.error('[FALLO] Falta HFS_FILE_ID en el estado local. Ejecuta Lab 01/02 primero.')
    process.exitCode = 1
    return
  }

  try {
    const __dirname = path.dirname(import.meta.filename)
    const assetsDir = path.resolve(__dirname, './assets')
    // Solo los documentos fuente: largeFile.png ya se subió en el Lab 02 y reconstructed_* son salidas de los Labs 05/08.
    const files = fs.readdirSync(assetsDir).filter((f) => !f.startsWith('reconstructed_') && f !== 'largeFile.png')

    console.log(`[INFO] Escaneando directorio: ${assetsDir}`)
    console.log(`[INFO] Se encontraron ${files.length} archivos para anclar en el bundle.`)

    // Construcción del Manifiesto Binario
    let combinedBuffer = Buffer.from('\n--- INICIO DEL MANIFIESTO MULTI-ACTIVO ---\n')

    for (const file of files) {
      const filePath = path.join(assetsDir, file)
      const stats = fs.statSync(filePath)
      const content = fs.readFileSync(filePath)

      console.log(`└─ [PACK] ${file} (${stats.size} bytes)`)

      combinedBuffer = Buffer.concat([
        combinedBuffer,
        Buffer.from(`\nARCHIVO: ${file}\nTIPO: ${path.extname(file)}\nTAMAÑO: ${stats.size}\n`),
        content,
        Buffer.from('\n--- FIN DEL ARCHIVO ---\n')
      ])
    }

    console.log(`\n[REGISTRO] Tamaño Total del Bundle: ${combinedBuffer.length} bytes`)

    // Fragmentación para estabilidad en la carga masiva
    const CHUNK_SIZE = 4096
    let lastResponse

    console.log(`[PROCESO] Transmitiendo bundle en ${Math.ceil(combinedBuffer.length / CHUNK_SIZE)} fragmentos...`)

    for (let i = 0; i < combinedBuffer.length; i += CHUNK_SIZE) {
      const chunk = combinedBuffer.slice(i, i + CHUNK_SIZE)

      // Agrega el siguiente fragmento: los archivos crecen una transacción a la vez.
      const transaction = await new FileAppendTransaction()
        .setFileId(FileId.fromString(fileId))
        .setContents(chunk)
        .freezeWith(client)

      lastResponse = await transaction.execute(client)
      // Espera el consenso: el recibo dice si la red aceptó la transacción.
      await lastResponse.getReceipt(client)
      console.log(`└─ Fragmento ${Math.floor(i / CHUNK_SIZE) + 1} anclado.`)
    }

    console.log(`\n[ÉXITO] Bundle multi-activo adjuntado al Archivo: ${fileId}`)
    console.log(`[REGISTRO] Ver última transacción: ${getHashscanUrl(lastResponse)}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Al usar un solo File ID para todo tu set de activos, reduces')
    console.log('considerablemente los costos de creación en la red y simplificas')
    console.log('la gobernanza de tus datos, permitiendo que una dApp entera')
    console.log('resida bajo una única dirección inmutable.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] El empaquetado masivo HFS falló:', error.message)
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
