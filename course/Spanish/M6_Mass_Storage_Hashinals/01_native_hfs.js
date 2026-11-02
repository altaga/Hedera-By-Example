/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Almacenamiento Nativo en HFS
 * [ CONCEPTO ] Persistencia de Capa 1 y Anclas de Veracidad
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Inmutabilidad Nativa: El Hedera File Service (HFS) es la capa de
 * almacenamiento persistente directa del ledger. A diferencia de IPFS, donde
 * los archivos pueden desaparecer si no se "pinean", los archivos en HFS
 * están resguardados por los mismos nodos de consenso nacionales de la red.
 * Un archivo en HFS es el "ancla" definitiva: solo quien posee la llave de
 * administración puede actualizarlo, pero cualquier persona en el mundo
 * puede leerlo de forma gratuita y verificada.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El Hedera File Service (HFS) almacena datos directamente en los nodos de consenso con inmutabilidad criptográfica. Para archivos de menos de 1024 bytes, FileCreateTransaction ofrece almacenamiento inmediato para contratos o llaves públicas.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/file-service
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M5 Lab 04: HCS Ping-Pong
 * - Actual:   M6 Lab 01: Almacenamiento Nativo HFS
 * - Siguiente: M6 Lab 02: Gestión de Archivos Grandes
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~5 ℏ en cada ejecución (sube un archivo, cerca de 0.3 USD).
 *
 * [ CÓMO EJECUTAR ]
 * node 01_native_hfs.js
 * ============================================================================
 */

import {
  FileCreateTransaction,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Almacenamiento Nativo (HFS) ---\n')

  const { client, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    const __dirname = path.dirname(import.meta.filename)
    const imagePath = path.resolve(__dirname, './assets/test_image.png')

    if (!fs.existsSync(imagePath)) {
      throw new Error(`Recurso educativo no encontrado en ${imagePath}`)
    }

    const imageBuffer = fs.readFileSync(imagePath)
    console.log(`[ℹ️ INFO] Recurso detectado: ${imagePath} (${imageBuffer.length} bytes)`)

    console.log('[⚙️ PROCESO] Creando contenedor de archivos persistente en Hedera...')

    const transaction = await new FileCreateTransaction()
      .setExpirationTime(new Date(Date.now() + 31 * 24 * 3600 * 1000)) // El almacenamiento se cobra por tamaño x vigencia: en testnet, corta
      .setKeys([adminKey.publicKey]) // Solo el admin puede modificarlo
      .setContents(imageBuffer)
      .freezeWith(client)

    const response = await transaction.execute(client)
    const receipt = await response.getReceipt(client)
    const fileId = receipt.fileId

    console.log(`[✅ ÉXITO] Archivo creado con éxito: ${fileId.toString()}`)
    console.log(`[📊 REGISTRO] Ver en HashScan: ${getHashscanUrl(response)}`)

    // Sincronizar para uso en laboratorios posteriores (HCS-1)
    updateState('HFS_FILE_ID', fileId.toString())

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Acabas de anclar un activo binario directamente al ledger.')
    console.log('Este File ID es ahora una dirección permanente. Cualquier')
    console.log('aplicación puede consultar su contenido vía REST API del')
    console.log('Mirror Node, garantizando la disponibilidad global sin')
    console.log('depender de servidores de almacenamiento centralizados.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La creación del archivo nativo HFS falló:', error.message)
    process.exitCode = 1
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
