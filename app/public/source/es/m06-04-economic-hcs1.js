/**
 * ============================================================================
 * Lab 04: Almacenamiento Económico con HCS-1 (Hashinals)
 * [CONCEPTO] Fragmentación (Sharding) y Ordenamiento Cronológico como Datos
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Eficiencia Extrema: Mientras que el HFS ofrece almacenamiento persistente en
 * los nodos, el HCS es mucho más económico. HCS-1 es un estándar de la comunidad
 * para guardar un archivo en un tópico: se comprime con zstd, se codifica en
 * base64 detrás de un data URI y se divide en mensajes ordenados {"o", "c"}. El
 * tópico tiene submit key, no tiene admin key y su memo es
 * "<sha256 del archivo>:zstd:base64", así que cualquier lector (por ejemplo la
 * CDN de Kiloscribe) puede reconstruir el archivo y comprobarlo.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * El estándar HCS-1 permite inscripciones on-chain altamente económicas: fragmentar archivos en mensajes ordenados de consenso en vez de almacenamiento en smart contracts cuesta solo una tarifa de mensaje por fragmento, muy por debajo del almacenamiento en contratos.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M6 Lab 03: Carga por Lotes Multi-Activo (Manifiestos Compuestos)
 * - Siguiente: M6 Lab 05: Reconstrucción Trustless de Datos desde HCS-1
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: <1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M6_Mass_Storage_Hashinals/04_economic_hcs1.js
 * ============================================================================
 */

import { getClient, updateState, show, inscribeHcs1 } from '../M99_Utilities/index.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Fragmentación Económica de Datos con HCS-1 ---\n')

  const { client } = getClient()

  try {
    const __dirname = path.dirname(import.meta.filename)
    const filePath = path.resolve(__dirname, './assets/largeFile.png')
    if (!fs.existsSync(filePath)) {
      throw new Error(`No se encontró el archivo en ${filePath}`)
    }

    const fileBuffer = fs.readFileSync(filePath)
    console.log(`[INFO] Leyendo datos binarios de: ${path.basename(filePath)}`)
    console.log(`[REGISTRO] Tamaño del archivo: ${fileBuffer.length} bytes`)
    console.log(`[REGISTRO] Identidad del archivo (SHA-256): ${crypto.createHash('sha256').update(fileBuffer).digest('hex')}`)

    // HCS-1: zstd -> data URI en base64 -> fragmentos {o, c} en un tópico con submit key y sin admin key.
    console.log('\n[PROCESO] Inscribiendo el archivo como HCS-1 (zstd + base64, memo "<sha256>:zstd:base64")...')
    const topicId = await inscribeHcs1(client, fileBuffer, 'image/png', {
      onChunk: (done, total) => {
        show.shards({ id: 'hcs1-upload', title: 'Fragmentos HCS-1 enviados', total, done })
        console.log(`[PROCESO] Fragmento ${done}/${total} enviado`)
      }
    })

    console.log(`\n[ÉXITO] Archivo HCS-1 inscrito en el tópico ${topicId}`)
    console.log(`[REGISTRO] HRL: hcs://1/${topicId}`)
    console.log(`[EXPLORADOR] https://hashscan.io/testnet/topic/${topicId}`)
    console.log(`[REGISTRO] CDN de HCS-1 (Kiloscribe): https://kiloscribe.com/api/inscription-cdn/${topicId}?network=testnet`)

    // Guardar el ID del tópico para la reconstrucción del Lab 05
    updateState('HCS1_TOPIC_ID', topicId)

    console.log('\n CONCEPTO CLAVE:')
    console.log('El Costo del Consenso: al usar HCS como almacenamiento pagas una tarifa de')
    console.log('mensaje por fragmento. zstd reduce antes el archivo, y el hash del memo le permite')
    console.log('a cualquier lector HCS-1 confirmar que reconstruyó exactamente este archivo.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la operación HCS-1:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FALLO] Error de Ejecución:', error.message)
      process.exit(1)
    })
}
