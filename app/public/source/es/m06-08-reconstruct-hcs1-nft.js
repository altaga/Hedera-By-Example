/**
 * ============================================================================
 * Lab 08: Reconstrucción de NFT HCS-1
 * [CONCEPTO] Resolución Recursiva de Activos
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Activos de Confianza Cero: Este script demuestra cómo resolver un NFT
 * "Nativo del Ledger" sin depender de IPFS o servidores centrales. A partir del
 * token y el serial leemos su HRL (hcs://1/<tópico>), reconstruimos el archivo
 * HCS-1 de metadatos, seguimos su HRL "image" y reconstruimos la imagen,
 * comprobando cada SHA-256.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Resolución en el cliente de un Hashinal (HCS-5): las billeteras consultan el Mirror Node, reconstruyen cada archivo HCS-1 en memoria, comprueban su SHA-256 contra el memo del tópico y muestran el arte sin servidores externos.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M6 Lab 07: NFT Nativo HCS-1 (Metadatos + Imagen en HCS)
 * - Siguiente: M6 Lab 09: Smart Hashinals HCS-7 (Estado EVM + Inscripciones Dinámicas WASM)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: no hace falta (solo lee el Mirror Node).
 * - Ejecuta antes: Lab 07 de M6 (este lab lee lo que guardó).
 * - Costo: gratis (solo lecturas del Mirror Node).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M6_Mass_Storage_Hashinals/08_reconstruct_hcs1_nft.js
 * ============================================================================
 */

import { getMirrorNodeBaseUrl, getState, waitForMirror, readHcs1, show } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const parseHrl = (value) => {
  const match = String(value).match(/^hcs:\/\/1\/(\d+\.\d+\.\d+)$/)
  if (!match) throw new Error(`"${value}" no es un HRL de HCS-1 (hcs://1/<topicId>)`)
  return match[1]
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Reconstrucción de NFT HCS-1 ---\n')

  const tokenId = getState('HCS_NFT_TOKEN_ID')
  const serial = getState('HCS_NFT_SERIAL')
  const mirrorNodeUrl = getMirrorNodeBaseUrl()

  if (!tokenId || !serial) {
    console.error('[FALLO] Falta el Hashinal en el estado. Ejecuta primero el Lab 07.')
    process.exitCode = 1
    return
  }

  try {
    // 1. La metadata del NFT es un HRL que apunta a un archivo HCS-1
    console.log(`[PROCESO] Leyendo la metadata de ${tokenId} serial #${serial}...`)
    // Un NFT recién acuñado aparece en el Mirror Node unos segundos después del consenso.
    const nftResponse = await waitForMirror(async () => {
      const res = await fetch(`${mirrorNodeUrl}/api/v1/tokens/${tokenId}/nfts/${serial}`)
      return res.ok ? res : null
    })
    if (!nftResponse) throw new Error(`Token no encontrado o error del Mirror Node: ${tokenId}/nfts/${serial}`)
    const rawMetadata = Buffer.from((await nftResponse.json()).metadata, 'base64').toString()
    console.log(`[ÉXITO] Metadata del NFT: "${rawMetadata}"`)
    const metadataTopicId = parseHrl(rawMetadata)

    // 2. Reconstruir el JSON de metadatos (readHcs1 comprueba el SHA-256 contra el memo del tópico)
    console.log(`\n[PROCESO] Reconstruyendo el archivo HCS-1 de metadatos ${metadataTopicId}...`)
    const metaFile = await readHcs1(metadataTopicId)
    console.log(`[VERIFY] El SHA-256 de los metadatos coincide con el memo del tópico: ${metaFile.hash.slice(0, 16)}...`)
    const metadata = JSON.parse(metaFile.bytes.toString())
    console.log('[ÉXITO] Metadatos reconstruidos:')
    console.log(JSON.stringify(metadata, null, 2))

    // 3. Seguir el HRL "image" y reconstruir la imagen
    const imageTopicId = parseHrl(metadata.image)
    console.log(`\n[PROCESO] Reconstruyendo el archivo HCS-1 de la imagen ${imageTopicId}...`)
    const imageFile = await readHcs1(imageTopicId)
    show.shards({ id: 'hcs1-stitch', title: 'Fragmentos de la imagen reensamblados', total: imageFile.chunks, done: imageFile.chunks })
    console.log(`[VERIFY] El SHA-256 de la imagen coincide con el memo del tópico: ${imageFile.hash.slice(0, 16)}... (${imageFile.mimeType}, ${imageFile.bytes.length} bytes)`)

    // 4. Guardar en disco
    const __dirname = path.dirname(import.meta.filename)
    const outputPath = path.resolve(__dirname, './output/reconstructed_nft.png')
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    }
    fs.writeFileSync(outputPath, imageFile.bytes)

    console.log('\n[ÉXITO] ¡Activo NFT reconstruido por completo!')
    console.log(`[INFO] Guardado en: ${outputPath}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Activos de Confianza Cero: nunca usamos una base de datos central ni IPFS.')
    console.log('Cada byte de los metadatos y de la imagen vino directamente del Hedera')
    console.log('Consensus Service a través de un Mirror Node, y se comprobó su SHA-256.')

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
