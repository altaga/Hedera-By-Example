/**
 * ============================================================================
 * Lab 05: Reconstrucción Trustless de Datos desde HCS-1
 * [CONCEPTO] Verificación Criptográfica de Integridad y Reensamblaje
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Verificación Sin Confianza: el lector trae todos los fragmentos del Mirror
 * Node, los ordena por "o", quita el prefijo del data URI, descomprime con zstd
 * y calcula el hash. Si el SHA-256 coincide con el memo del tópico, la imagen
 * es byte por byte la que se inscribió, sin ningún servidor central.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Reconstruir un archivo HCS-1 significa ordenar los fragmentos por su campo de orden, descomprimir y comprobar el SHA-256 contra el memo del tópico antes de confiar en los bytes.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M6 Lab 04: Almacenamiento Económico con HCS-1 (Hashinals)
 * - Siguiente: M6 Lab 06: El Ecosistema Hashinals
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: no hace falta (solo lee el Mirror Node).
 * - Ejecuta antes: Lab 04 de M6 (este lab lee lo que guardó).
 * - Costo: gratis (solo lecturas del Mirror Node).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M6_Mass_Storage_Hashinals/05_reconstruct_hcs1.js
 * ============================================================================
 */

import { getState, readHcs1, show } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Reconstrucción de Datos HCS-1 ---\n')

  const topicId = getState('HCS1_TOPIC_ID')

  if (!topicId) {
    console.error('[FALLO] Falta HCS1_TOPIC_ID en el estado. Ejecuta primero el Lab 04 de M6.')
    process.exitCode = 1
    return
  }

  try {
    console.log(`[PROCESO] Leyendo el archivo HCS-1 hcs://1/${topicId} desde el Mirror Node...`)
    console.log('[INFO] Pasos: traer todos los fragmentos {o, c} -> ordenar por o -> quitar el data URI -> descomprimir zstd -> SHA-256')

    // readHcs1 solo devuelve el archivo si el SHA-256 de los bytes descomprimidos coincide con el memo.
    const file = await readHcs1(topicId)
    show.shards({ id: 'hcs1-stitch', title: 'Fragmentos HCS-1 reensamblados', total: file.chunks, done: file.chunks })
    console.log(`[REGISTRO] Fragmentos: ${file.chunks} | Tipo MIME: ${file.mimeType}`)
    console.log(`[VERIFY] El SHA-256 del archivo reconstruido coincide con el memo del tópico: ${file.hash}`)

    const dateStr = new Date().toISOString().split('T')[0]
    const outputPath = path.resolve(import.meta.dirname, `./output/reconstructed_${dateStr}.png`)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, file.bytes)

    console.log('\n[ÉXITO] ¡Reconstrucción completada!')
    console.log(`[REGISTRO] Tamaño final de la imagen: ${file.bytes.length} bytes`)
    console.log(`[INFO] Guardada en: ${outputPath}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Reconstrucción sin confianza: los fragmentos volvieron en orden y el SHA-256 del')
    console.log('archivo descomprimido coincidió con el memo del tópico, así que la imagen')
    console.log('reconstruida es byte por byte la que se inscribió.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la reconstrucción:', error.message)
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
