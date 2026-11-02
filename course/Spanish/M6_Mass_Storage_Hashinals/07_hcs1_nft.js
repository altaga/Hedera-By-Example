/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 07: NFT Nativo HCS-1 (Metadatos + Imagen en HCS)
 * [ CONCEPTO ] Artefactos Digitales Totalmente Descentralizados
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Más allá de IPFS: Aunque IPFS es común, sigue dependiendo de disponibilidad
 * externa. Al almacenar TANTO los metadatos como la imagen en shards de HCS,
 * tu activo se vuelve 100% "Nativo del Ledger". Cualquier Mirror Node se
 * convierte en tu proveedor de almacenamiento.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Vincular un topic de inscripción HCS-1 directamente a un NFT en HTS crea un activo digital 100% descentralizado e inmutable sin depender de servicios externos de fijación en IPFS.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hashgraphonline.com/standards/hcs-1/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M6 Lab 06: Ecosistema Hashinals
 * - Siguiente: M6 Lab 08: Reconstrucción de NFT
 *
 * [ CÓMO EJECUTAR ]
 * node 07_hcs1_nft.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenType,
  TokenSupplyType,
  AccountId,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, updateState, getHashscanUrl, show, reuseToken } from '../M99_Utilities/index.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

/**
 * Pipeline HCS-1: Divide un buffer en mensajes JSON estándar
 */
const constructHcs1Payloads = (fileBuffer, topicIdStr) => {
  const fileHashHex = crypto.createHash('sha256').update(fileBuffer).digest('hex')
  const base64Str = fileBuffer.toString('base64')

  const MAX_CHUNK_SIZE = 700
  const chunks = []

  for (let i = 0; i < base64Str.length; i += MAX_CHUNK_SIZE) {
    chunks.push(base64Str.slice(i, i + MAX_CHUNK_SIZE))
  }

  return chunks.map((chunk, index) => ({
    h: 'hcs-1',
    fid: fileHashHex,
    s: topicIdStr,
    i: index,
    t: chunks.length,
    d: chunk
  }))
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Minado de NFT Nativo HCS-1 ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    const __dirname = path.dirname(import.meta.filename)
    const filePath = path.resolve(__dirname, './assets/largeFile.png')
    if (!fs.existsSync(filePath)) {
      throw new Error(`Activo no encontrado en ${filePath}`)
    }

    const fileBuffer = fs.readFileSync(filePath)
    const imageHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')

    console.log(`[ℹ️ INFO] Activo: ${path.basename(filePath)} (${fileBuffer.length} bytes)`)
    console.log(`[📊 LOG] FID del Activo: ${imageHash}`)

    // 1. Crear el Topic de Almacenamiento HCS
    console.log('\n[⚙️ PROCESO] Creando Topic de Almacenamiento HCS...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('Ancla de Activos HCS-1')
      .freezeWith(client)

    const topicRes = await topicTx.execute(client)
    const topicReceipt = await topicRes.getReceipt(client)
    const topicId = topicReceipt.topicId
    const topicIdStr = topicId.toString()

    console.log(`[✅ ÉXITO] Topic HCS Creado: ${topicIdStr}`)

    // 2. Enviar Shards de la Imagen
    const imagePayloads = constructHcs1Payloads(fileBuffer, topicIdStr)
    console.log(`[ℹ️ INFO] Enviando ${imagePayloads.length} shards de imagen a HCS...`)

    for (const payload of imagePayloads) {
      show.shards({ id: 'hcs1-image', title: 'Fragmentos de imagen enviados', total: payload.t, done: payload.i + 1 })
      process.stdout.write(` └─ [⚙️] Shard ${payload.i + 1}/${payload.t}\r`)
      const submitTx = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify(payload))
        .execute(client)
      await submitTx.getReceipt(client)
    }
    process.stdout.write('\n[✅ ÉXITO] Shards de Imagen Anclados.\n')

    // 3. Construir y Enviar Metadatos JSON (HIP-412)
    const metadataJSON = {
      name: 'NFT Económico HCS-1 #1',
      creator: 'Desarrollador Hedera',
      description: 'Un NFT totalmente descentralizado con imagen y metadatos en HCS.',
      image: `hcs://${topicIdStr}?fid=${imageHash}`,
      type: 'image/png',
      format: 'HIP412@2.0.0',
      properties: {
        protocolo: 'hcs-1',
        almacenamiento: 'Hedera Consensus Service'
      }
    }

    const metaBuffer = Buffer.from(JSON.stringify(metadataJSON))
    const metaHash = crypto.createHash('sha256').update(metaBuffer).digest('hex')
    const metaPayloads = constructHcs1Payloads(metaBuffer, topicIdStr)

    console.log(`\n[ℹ️ INFO] Enviando manifiesto de Metadatos (${metaPayloads.length} shard)...`)
    for (const payload of metaPayloads) {
      const submitTx = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify(payload))
        .execute(client)
      await submitTx.getReceipt(client)
    }
    console.log('[✅ ÉXITO] Shard de Metadatos Anclado.')

    // 4. Crear la Colección NFT
    console.log('\n[⚙️ PROCESO] Creando Colección NFT...')
    const tokenId = await reuseToken('REUSE_M6_07_TOKEN', async () => {
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('Artefacto Económico HCS-1')
        .setTokenSymbol('HCSNFT')
        .setTokenType(TokenType.NonFungibleUnique)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100)
        .setSupplyKey(adminKey)
        .freezeWith(client)

      const tokenRes = await tokenTx.execute(client)
      const tokenReceipt = await tokenRes.getReceipt(client)
      return tokenReceipt.tokenId
    })

    console.log(`[✅ ÉXITO] ID de Colección: ${tokenId.toString()}`)

    // 5. Minar Serial #1 apuntando a Metadatos HCS
    const hcsPointer = `hcs://${topicIdStr}?fid=${metaHash}`
    console.log(`\n[⚙️ PROCESO] Minando Serial #1 con Puntero: ${hcsPointer}`)

    const mintTx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .addMetadata(Buffer.from(hcsPointer))
      .freezeWith(client)

    const mintRes = await mintTx.execute(client)
    await mintRes.getReceipt(client)

    console.log('\n[✅ ÉXITO] ¡NFT Nativo HCS-1 Minado!')
    console.log(`[📊 LOG] Ver NFT en Hashscan: ${getHashscanUrl(mintRes)}`)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Inscripción Autónoma de Confianza Cero: Los metadatos y la imagen se almacenan')
    console.log('directamente en shards de HCS, eliminando dependencias de servidores IPFS.')

    console.log('\n💡 MOMENTO DE APRENDIZAJE:')
    console.log('Lógica de Resolución Frontend:')
    console.log(`1. Leer metadatos del NFT: "${hcsPointer}"`)
    console.log(`2. Consultar Mirror Node: /api/v1/topics/${topicIdStr}/messages`)
    console.log(`3. Filtrar mensajes donde JSON.fid === "${metaHash}"`)
    console.log('4. Reconstruir JSON -> extraer imagen: "hcs://..."')
    console.log(`5. Filtrar mensajes donde JSON.fid === "${imageHash}"`)
    console.log('6. Reconstruir Base64 de Imagen -> Renderizar.')

    updateState('HCS_NFT_TOKEN_ID', tokenId.toString())
    updateState('HCS_NFT_TOPIC_ID', topicIdStr)

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLÓ] La operación falló:', error.message)
    process.exitCode = 1
    if (client) client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
