/**
 * ============================================================================
 * Lab 08: Reconstrucción de NFT HCS-1
 * [CONCEPTO] Resolución Recursiva de Activos
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Activos de Confianza Cero: Este script demuestra cómo resolver un NFT
 * "Nativo del Ledger" sin depender de IPFS o servidores centrales. Al comenzar
 * con un ID de Token, encontramos el puntero HCS y reconstruimos recursivamente
 * tanto los metadatos como la imagen binaria directamente desde el Mirror Node.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * La verificación en el cliente de inscripciones NFT HCS-1 garantiza su autenticidad: las billeteras pueden consultar el Mirror Node, reensamblar los fragmentos en memoria y renderizar el arte sin servidores externos.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M6 Lab 07: NFT Nativo HCS-1
 * - Siguiente: M6 Lab 09: Smart Hashinals HCS-7
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 03 de M3, Lab 07 de M6 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 08_reconstruct_hcs1_nft.js
 * ============================================================================
 */

import { getMirrorNodeBaseUrl, getState, waitForMirror, show } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Reconstrucción de NFT HCS-1 ---\n')

  const tokenId = getState('HCS_NFT_TOKEN_ID') || getState('NFT_TOKEN_ID')
  const mirrorNodeUrl = getMirrorNodeBaseUrl()

  if (!tokenId) {
    console.error('[FALLÓ] Falta el ID del Token en el estado. Ejecuta el Lab 07 primero.')
    process.exitCode = 1
    return
  }

  try {
    // 1. Obtener Puntero de Metadatos (Serial #1)
    console.log(`[PROCESO] Obteniendo Puntero de Metadatos para ${tokenId} Serial 1...`)
    // Un NFT recién acuñado aparece en el Mirror Node unos segundos después del consenso.
    const nftResponse = await waitForMirror(async () => {
      const res = await fetch(`${mirrorNodeUrl}/api/v1/tokens/${tokenId}/nfts/1`)
      return res.ok ? res : null
    })
    if (!nftResponse) throw new Error(`Token no encontrado o error de Mirror Node: ${tokenId}/nfts/1`)

    const nftData = await nftResponse.json()
    const rawMetadata = Buffer.from(nftData.metadata, 'base64').toString()
    console.log(`[ÉXITO] Puntero Encontrado: "${rawMetadata}"`)

    if (!rawMetadata.startsWith('hcs://')) {
      throw new Error('Este NFT no parece ser un NFT Nativo HCS-1.')
    }

    // Parsear hcs://<topicId>?fid=<fid>
    const [topicPart, queryPart] = rawMetadata.replace('hcs://', '').split('?')
    const topicId = topicPart
    const query = new URLSearchParams(queryPart || '')
    const metaFid = query.get('fid')

    console.log(`[LOG] Topic Destino: ${topicId}`)
    console.log(`[LOG] FID de Metadatos: ${metaFid}`)

    // 2. Obtener todos los mensajes del Topic HCS
    console.log(`\n[PROCESO] Obteniendo mensajes HCS del Topic ${topicId}...`)
    let nextLink = `/api/v1/topics/${topicId}/messages`
    const allMessages = []

    while (nextLink) {
      const response = await fetch(`${mirrorNodeUrl}${nextLink}`)
      const data = await response.json()
      allMessages.push(...data.messages)
      nextLink = data.links?.next || null
    }
    console.log(`[ÉXITO] Se recuperaron ${allMessages.length} mensajes HCS totales.`)

    // Ayudante para reconstruir archivo desde shards
    const reconstructFile = (messages, targetFid) => {
      const shards = messages
        .map(m => {
          try {
            const decoded = Buffer.from(m.message, 'base64').toString()
            return JSON.parse(decoded)
          } catch (e) { return null }
        })
        .filter(sh => sh && sh.h === 'hcs-1' && sh.fid === targetFid)

      if (shards.length === 0) throw new Error(`No se encontraron shards para el FID: ${targetFid}`)

      shards.sort((a, b) => a.i - b.i)
      const totalExpected = shards[0].t
      if (shards.length < totalExpected) throw new Error(`Datos incompletos: se encontraron ${shards.length}/${totalExpected} shards.`)

      let fullBase64 = ''
      for (const shard of shards) fullBase64 += shard.d
      show.shards({ id: 'hcs1-stitch', title: 'Fragmentos reensamblados', total: totalExpected, done: shards.length })
      return Buffer.from(fullBase64, 'base64')
    }

    // 3. Reconstruir JSON de Metadatos
    console.log('\n[PROCESO] Reconstruyendo JSON de Metadatos...')
    const metaBuffer = reconstructFile(allMessages, metaFid)
    const metadata = JSON.parse(metaBuffer.toString())
    console.log('[ÉXITO] Metadatos Reconstruidos:')
    console.log(JSON.stringify(metadata, null, 2))

    // 4. Extraer y Reconstruir Imagen
    const imagePointer = metadata.image
    if (!imagePointer.startsWith('hcs://')) {
      throw new Error('El puntero de imagen en los metadatos no cumple con HCS-1.')
    }

    const [, imageQueryPart] = imagePointer.replace('hcs://', '').split('?')
    const imageQuery = new URLSearchParams(imageQueryPart || '')
    const imageFid = imageQuery.get('fid')

    console.log(`\n[PROCESO] Reconstruyendo Imagen (FID: ${imageFid})...`)
    const imageBuffer = reconstructFile(allMessages, imageFid)

    // 5. Guardar en Disco
    const __dirname = path.dirname(import.meta.filename)
    const outputPath = path.resolve(__dirname, './assets/reconstructed_nft.png')

    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    }
    fs.writeFileSync(outputPath, imageBuffer)

    console.log('\n[ÉXITO] ¡Activo del NFT Reconstruido Completamente!')
    console.log(`[INFO] Guardado en: ${outputPath}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Activos de Confianza Cero: Nota cómo nunca usamos una base de datos')
    console.log('central o IPFS. Cada byte de los metadatos y la imagen vino directamente')
    console.log('del Hedera Consensus Service a través de un Mirror Node. Esto es')
    console.log('permanencia real.')

    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLÓ] Reconstrucción Fallida:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
