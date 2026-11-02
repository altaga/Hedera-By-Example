/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Emisión de NFT con Metadatos On-Chain (HIP-412)
 * [ CONCEPTO ] Almacenamiento Nativo y Estándares de Interoperabilidad
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * El Estándar de Oro: HIP-412 V2 es la especificación que garantiza que tus
 * NFTs sean compatibles con todas las billeteras y marketplaces (HashPack,
 * Kabila, SentX). A diferencia de otras redes que dependen de servidores
 * externos, Hedera permite usar the Hedera File Service (HFS) para almacenar
 * la imagen y el JSON de metadatos directamente en los nodos del ledger,
 * asegurando la permanencia e inmutabilidad total del activo digital.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Nunca almacenes imágenes pesadas directamente en el ledger. Aloja el contenido multimedia en IPFS, Arweave o HCS, y acuña el NFT con su URI JSON estándar HIP-412 para optimizar rendimiento y renta de estado.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-412
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M3 Lab 02: Identidad Financiera
 * - Actual:   M3 Lab 03: NFTs con HIP-412
 * - Siguiente: M3 Lab 04: Lectura de NFTs
 *
 * [ CÓMO EJECUTAR ]
 * node 03_nft_hip412.js
 * ============================================================================
 */

import {
  AccountId,
  FileAppendTransaction,
  FileCreateTransaction,
  PrivateKey,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType
} from '@hiero-ledger/sdk'
import fs from 'fs'
import path from 'path'
import { getClient, getHashscanUrl, updateState, reuseToken } from '../M99_Utilities/index.js'

/**
 * Generador de metadatos cumpliendo con HIP-412 JSON v2
 */
const generateHIP412Metadata = (name, description, imageURI, creator, attributesMap) => {
  return {
    name,
    creator,
    description,
    image: imageURI,
    type: 'image/png',
    format: 'HIP412@2.0.0',
    properties: {
      ...attributesMap
    },
    attributes: Object.entries(attributesMap).map(([traitType, value]) => ({
      trait_type: traitType,
      value
    }))
  }
}

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Creación de Colección NFT Inmutable ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const treasuryKey = PrivateKey.fromString(operatorKey)

  try {
    // 1. Subir Imagen al Hedera File Service (HFS)
    console.log('[⚙️ PROCESO] Preparando carga de imagen nativa al HFS...')
    const __dirname = path.dirname(import.meta.filename)
    const imagePath = path.resolve(__dirname, './assets/logonft.png')

    if (!fs.existsSync(imagePath)) {
      throw new Error(`Recurso no encontrado en ${imagePath}`)
    }

    const imageBuffer = fs.readFileSync(imagePath)
    console.log(`[ℹ️ INFO] Archivo detectado: ${imageBuffer.length} bytes. Fragmentando para HFS...`)

    // A. CREAR EL ARCHIVO (Bloque inicial)
    const CHUNK_SIZE = 4096 // Límite de 4KB por transacción en HFS
    const initialChunk = imageBuffer.slice(0, CHUNK_SIZE)

    const fileTx = await new FileCreateTransaction()
      .setExpirationTime(new Date(Date.now() + 31 * 24 * 3600 * 1000)) // El almacenamiento se cobra por tamaño x vigencia: en testnet, corta
      .setKeys([treasuryKey.publicKey])
      .setContents(initialChunk)
      .freezeWith(client)

    const fileResponse = await fileTx.execute(client)
    const fileReceipt = await fileResponse.getReceipt(client)
    const fileId = fileReceipt.fileId

    console.log(`[✅ ÉXITO] Contenedor HFS inicializado: ${fileId.toString()}`)

    // B. ADJUNTAR BYTES RESTANTES (APPEND)
    for (let i = CHUNK_SIZE; i < imageBuffer.length; i += CHUNK_SIZE) {
      const chunk = imageBuffer.slice(i, i + CHUNK_SIZE)
      const appendTx = await new FileAppendTransaction()
        .setFileId(fileId)
        .setContents(chunk)
        .freezeWith(client)

      const appendResponse = await appendTx.execute(client)
      await appendResponse.getReceipt(client)
      console.log(`[⚙️ PROCESO] Fragmento ${i} subido exitosamente.`)
    }

    console.log(`\n[✅ ÉXITO] Imagen almacenada On-Chain: ${fileId.toString()}`)

    // 2. Crear la Colección de NFT
    console.log("\n[⚙️ PROCESO] Creando la colección 'Hedera Syllabus NFT'...")
    const tokenId = await reuseToken('REUSE_M3_03_TOKEN', async () => {
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('Hedera Syllabus NFT')
        .setTokenSymbol('HSNFT')
        .setTokenType(TokenType.NonFungibleUnique)
        .setDecimals(0)
        .setInitialSupply(0)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100)
        .setSupplyKey(treasuryKey)
        .freezeWith(client)

      const tokenResponse = await tokenTx.execute(client)
      const tokenReceipt = await tokenResponse.getReceipt(client)
      return tokenReceipt.tokenId
    })

    console.log(`[✅ ÉXITO] Colección NFT creada: ${tokenId.toString()}`)
    updateState('NFT_TOKEN_ID', tokenId.toString())

    // 3. Gestionar Metadatos HIP-412 V2
    const imageURI = `hedera://${fileId.toString()}`
    const metadataJSON = generateHIP412Metadata(
      'Hedera Badge #1',
      'Certificado de Nivel Pro en Almacenamiento Nativo HFS',
      imageURI,
      'Hedera Developer',
      { rarity: 'Legendary', content: 'Immutable' }
    )

    console.log('\n[📊 REGISTRO] JSON de Metadatos (HIP-412 V2):')
    console.log(JSON.stringify(metadataJSON, null, 2))

    console.log('\n[⚙️ PROCESO] Almacenando JSON de metadatos en un nuevo archivo HFS...')
    const metadataStr = JSON.stringify(metadataJSON)
    const metadataFileTx = await new FileCreateTransaction()
      .setExpirationTime(new Date(Date.now() + 31 * 24 * 3600 * 1000)) // El almacenamiento se cobra por tamaño x vigencia: en testnet, corta
      .setKeys([treasuryKey.publicKey])
      .setContents(metadataStr)
      .freezeWith(client)

    const metadataFileRes = await metadataFileTx.execute(client)
    const metadataFileReceipt = await metadataFileRes.getReceipt(client)
    const metadataFileId = metadataFileReceipt.fileId

    console.log(`[✅ ÉXITO] Metadatos persistidos On-Chain: ${metadataFileId.toString()}`)

    // 4. Emisión (Mint) de Seriales
    console.log(`\n[⚙️ PROCESO] Realizando Mint de Seriales #1 al #5 para ${tokenId.toString()}...`)
    const metadataPointer = `hedera://1/${metadataFileId.toString()}`

    const mintTx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .addMetadata(Buffer.from(metadataPointer))
      .addMetadata(Buffer.from(metadataPointer))
      .addMetadata(Buffer.from(metadataPointer))
      .addMetadata(Buffer.from(metadataPointer))
      .addMetadata(Buffer.from(metadataPointer))
      .freezeWith(client)

    const mintResponse = await mintTx.execute(client)
    const mintReceipt = await mintResponse.getReceipt(client)

    console.log(`\n[📊 REGISTRO] Ver Transacción: ${getHashscanUrl(mintResponse)}`)
    console.log(`\n[✅ ÉXITO] Seriales Emitidos: ${mintReceipt.serials.join(', ')}`)

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Al usar el protocolo `hedera://` para apuntar de un archivo')
    console.log('a otro, creas un ecosistema de datos 100% auditable y')
    console.log('permanente, sin depender de la volatilidad de servidores web')
    console.log('tradicionales.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La operación de NFT falló:', error.message)
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
