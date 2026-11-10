/**
 * ============================================================================
 * Lab 07: NFT Nativo HCS-1 (Metadatos + Imagen en HCS)
 * [CONCEPTO] Artefactos Digitales Totalmente Descentralizados
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Más allá de IPFS: Aunque IPFS es común, sigue dependiendo de disponibilidad
 * externa. Aquí TANTO la imagen como los metadatos HIP-412 son archivos HCS-1, y
 * la metadata del NFT es el HRL "hcs://1/<tópico de metadatos>": esto es un
 * Hashinal (HCS-5). Cualquier Mirror Node que conserve el historial del tópico,
 * o la CDN de Kiloscribe, puede servirlo, sin pagar un servicio de pinning.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Vincular un tópico de inscripción HCS-1 directamente a un NFT en HTS crea un activo digital totalmente on-chain sin depender de servicios externos de fijación en IPFS.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hol.org/docs/standards/hcs-1/
 * - https://hol.org/docs/standards/hcs-5/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M6 Lab 06: El Ecosistema Hashinals
 * - Siguiente: M6 Lab 08: Reconstrucción de NFT HCS-1
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD); ~3 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M6_Mass_Storage_Hashinals/07_hcs1_nft.js
 * ============================================================================
 */

import {
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenType,
  TokenSupplyType,
  AccountId,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, updateState, getHashscanUrl, show, reuseToken, inscribeHcs1 } from '../M99_Utilities/index.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Acuñación de NFT Nativo HCS-1 (Hashinal, HCS-5) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    const __dirname = path.dirname(import.meta.filename)
    const filePath = path.resolve(__dirname, './assets/largeFile.png')
    if (!fs.existsSync(filePath)) {
      throw new Error(`No se encontró el archivo en ${filePath}`)
    }
    const fileBuffer = fs.readFileSync(filePath)
    console.log(`[INFO] Archivo: ${path.basename(filePath)} (${fileBuffer.length} bytes)`)
    console.log(`[REGISTRO] SHA-256 de la imagen: ${crypto.createHash('sha256').update(fileBuffer).digest('hex')}`)

    // 1. Inscribir la imagen como archivo HCS-1
    console.log('\n[PROCESO] Inscribiendo la imagen como HCS-1...')
    const imageTopicId = await inscribeHcs1(client, fileBuffer, 'image/png', {
      onChunk: (done, total) => show.shards({ id: 'hcs1-image', title: 'Fragmentos de la imagen enviados', total, done })
    })
    console.log(`[ÉXITO] Imagen inscrita: hcs://1/${imageTopicId}`)

    // 2. Inscribir los metadatos HIP-412 (que apuntan a la imagen) como un segundo archivo HCS-1
    const metadataJSON = {
      name: 'Economic HCS-1 NFT #1',
      creator: 'Hedera Developer',
      description: 'Un Hashinal: la imagen y los metadatos son archivos HCS-1 en Hedera.',
      image: `hcs://1/${imageTopicId}`,
      type: 'image/png',
      format: 'HIP412@2.0.0',
      properties: { standard: 'hcs-5', storage: 'hcs-1' }
    }
    console.log('\n[PROCESO] Inscribiendo los metadatos HIP-412 como HCS-1...')
    const metadataTopicId = await inscribeHcs1(client, Buffer.from(JSON.stringify(metadataJSON)), 'application/json')
    console.log(`[ÉXITO] Metadatos inscritos: hcs://1/${metadataTopicId}`)

    // 3. La colección NFT (se reutiliza en ejecuciones posteriores)
    console.log('\n[PROCESO] Creando la colección NFT...')
    const tokenId = await reuseToken('REUSE_M6_07_TOKEN', async () => {
      // Crear el token: sus llaves (admin, supply, KYC, freeze...) deciden quién puede cambiarlo después.
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('HCS-1 Economic Artifact')
        .setTokenSymbol('HCSNFT')
        .setTokenType(TokenType.NonFungibleUnique)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100)
        .setSupplyKey(adminKey)
        .freezeWith(client)
      const tokenRes = await tokenTx.execute(client)
      return (await tokenRes.getReceipt(client)).tokenId
    })
    console.log(`[ÉXITO] ID de la colección: ${tokenId.toString()}`)

    // 4. Acuñar: la metadata del NFT es el HRL del archivo de metadatos (HCS-5)
    const hrl = `hcs://1/${metadataTopicId}`
    console.log(`\n[PROCESO] Acuñando un serial con metadata ${hrl}...`)
    // Acuñar: solo la supply key puede crear nuevas unidades o seriales.
    const mintRes = await (await new TokenMintTransaction()
      .setTokenId(tokenId)
      .addMetadata(Buffer.from(hrl))
      .freezeWith(client)).execute(client)
    const serial = (await mintRes.getReceipt(client)).serials[0].toString()
    console.log(`\n[ÉXITO] Hashinal acuñado: ${tokenId} serial #${serial}`)
    console.log(`[REGISTRO] Ver el NFT en HashScan: ${getHashscanUrl(mintRes)}`)
    console.log(`[REGISTRO] Imagen vía la CDN de HCS-1: https://kiloscribe.com/api/inscription-cdn/${imageTopicId}?network=testnet`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Inscripción Nativa del Ledger: los metadatos y la imagen son archivos HCS-1, así que')
    console.log('el NFT no depende de ningún pin de IPFS ni servidor web, solo de Hedera y sus Mirror Nodes.')

    console.log('\n MOMENTO DE APRENDIZAJE:')
    console.log('Lógica de resolución en el frontend (HCS-5):')
    console.log(`1. Leer la metadata del NFT: "${hrl}"`)
    console.log(`2. Reconstruir el archivo HCS-1 ${metadataTopicId} (ordenar fragmentos {o,c}, descomprimir zstd, comprobar el SHA-256 del memo)`)
    console.log(`3. Leer "image" del JSON: "hcs://1/${imageTopicId}"`)
    console.log(`4. Reconstruir el archivo HCS-1 ${imageTopicId} igual -> mostrar.`)

    updateState('HCS_NFT_TOKEN_ID', tokenId.toString())
    updateState('HCS_NFT_SERIAL', serial)
    updateState('HCS_NFT_TOPIC_ID', metadataTopicId)

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Falló la operación:', error.message)
    process.exitCode = 1
    if (client) client.close()
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
