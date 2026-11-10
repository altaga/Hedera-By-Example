/**
 * ============================================================================
 * Lab 08: Metadatos NFT HIP-412
 * [CONCEPTO] Esquema JSON Estandarizado para NFTs
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * HIP-412 define el esquema JSON estándar para metadatos de NFT en Hedera.
 * Al adherirse a este esquema, los exploradores (como Hashscan) y billeteras
 * (como HashPack/Kabila) pueden renderizar correctamente la imagen, atributos
 * y propiedades de tu NFT. Los metadatos generalmente se suben a IPFS (o HCS),
 * y el URI se pasa a la `TokenMintTransaction`.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Validar esquemas JSON estrictamente contra HIP412@2.0.0 evita imágenes rotas y atributos ausentes en exploradores como Hashscan y billeteras como HashPack, asegurando interoperabilidad en todo el ecosistema.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-412
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M3 Lab 07: NFTs Dinámicos (HIP-657)
 * - Siguiente: M3 Lab 09: Actualización en Tesorería con Supply-Key y Bloqueo Post-Envío (HIP-850)
 *
 * [ SIMULADO ]
 * La subida a un servicio de pinning es simulada; los identificadores de contenido son reales. El lab
 * calcula el CIDv1 exacto (raw, sha2-256) que IPFS asigna a la imagen y al JSON de metadatos (lo que
 * devuelve `ipfs add --cid-version=1` para un archivo así de pequeño), y el "pin" responde con el
 * mismo formato que pinFileToIPFS de Pinata. Hasta que alguien suba esos mismos bytes, los enlaces
 * ipfs:// no resuelven. La colección y la acuñación son reales.
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD); <1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M3_Hedera_Token_Service/08_hip412_metadata.js
 * ============================================================================
 */

import {
  NftId,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TokenMintTransaction,
  TokenNftInfoQuery,
  PrivateKey
} from '@hiero-ledger/sdk'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { getClient, reuseToken } from '../M99_Utilities/index.js'

/**
 * Función auxiliar que genera un JSON que cumple estrictamente HIP-412.
 */
function generateHIP412Metadata (name, image, description, attributes) {
  return {
    name,
    creator: 'Curso Hedera For Dummies',
    description,
    image, // Debe ser un URI válido (ej. ipfs://...)
    type: 'image/png',
    format: 'HIP412@2.0.0', // Requerido por el estándar
    attributes,
    properties: {
      collection: 'Serie Educativa HIP-412',
      website: 'https://hbe.expo.app'
    }
  }
}

/**
 * CIDv1 de un archivo de un solo bloque, tal como lo calcula IPFS (https://github.com/multiformats/cid):
 * <versión 0x01><codec raw 0x55><multihash: sha2-256 0x12, largo 0x20, digest>, en base32 (prefijo "b").
 */
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
const cidV1Raw = (bytes) => {
  const data = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), createHash('sha256').update(bytes).digest()])
  let bits = 0
  let value = 0
  let out = 'b'
  for (const byte of data) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

// Misma forma de respuesta que POST /pinning/pinFileToIPFS de Pinata (simulado: no se sube nada).
const simulatePin = (bytes) => ({ IpfsHash: cidV1Raw(bytes), PinSize: bytes.length, Timestamp: new Date().toISOString(), isDuplicate: false })

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Metadatos HIP-412 ---')

  const { client, operatorKey, operatorId } = getClient()
  const supplyKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Direccionar la imagen por su contenido
    const image = fs.readFileSync(new URL('./assets/logonft.png', import.meta.url))
    const imagePin = simulatePin(image)
    console.log(`\n[PROCESO] Imagen: logonft.png (${image.length} bytes)`)
    console.log(`[REGISTRO] Respuesta del pin (simulada): ${JSON.stringify(imagePin)}`)

    // 2. Generar el JSON de metadatos que apunta al CID de la imagen
    console.log('\n[PROCESO] Construyendo el JSON conforme a HIP-412...')
    const metadataObj = generateHIP412Metadata(
      'Espada Maestra HIP-412',
      `ipfs://${imagePin.IpfsHash}`,
      'Una espada legendaria forjada en los fuegos del consenso de Hedera.',
      [
        { trait_type: 'Ataque', value: 99 },
        { trait_type: 'Elemento', value: 'Fuego' },
        { trait_type: 'Rareza', value: 'Legendaria' }
      ]
    )
    console.log('[REGISTRO] Contenido HIP-412:')
    console.log(JSON.stringify(metadataObj, null, 2))

    // 3. Direccionar el JSON de metadatos por su contenido: el NFT guarda solo este URI corto (límite de 100 bytes)
    const metadataBytes = Buffer.from(JSON.stringify(metadataObj))
    const metadataPin = simulatePin(metadataBytes)
    const metadataUri = `ipfs://${metadataPin.IpfsHash}`
    console.log(`\n[REGISTRO] Respuesta del pin (simulada): ${JSON.stringify(metadataPin)}`)
    console.log(`[INFO] URI de metadatos: ${metadataUri} (${Buffer.byteLength(metadataUri)} bytes, cabe en el límite de 100 bytes de metadata del NFT)`)

    // 4. Crear la colección NFT
    console.log('\n[PROCESO] Creando la colección NFT...')
    const tokenId = await reuseToken('REUSE_M3_08_TOKEN', async () => {
      const createTx = await new TokenCreateTransaction()
        .setTokenName('HIP-412 Items')
        .setTokenSymbol('ITM')
        .setTokenType(TokenType.NonFungibleUnique)
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(supplyKey)
        .freezeWith(client)
      const signed = await createTx.sign(supplyKey)
      return (await (await signed.execute(client)).getReceipt(client)).tokenId
    })
    console.log(`[ÉXITO] Colección creada: ${tokenId.toString()}`)

    // 5. Acuñar el NFT con el URI HIP-412
    console.log('\n[PROCESO] Acuñando el NFT con el URI de metadatos HIP-412...')
    const tx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata([Buffer.from(metadataUri)])
      .freezeWith(client)
    const receipt = await (await (await tx.sign(supplyKey)).execute(client)).getReceipt(client)
    const serialNum = receipt.serials[0].toNumber()
    console.log(`[ÉXITO] Serial acuñado #${serialNum}`)

    // 6. Verificar: leer el URI de vuelta y comprobar que es el CID de exactamente estos bytes
    const nftInfo = await new TokenNftInfoQuery()
      .setNftId(new NftId(tokenId, serialNum))
      .execute(client)
    const onChain = Buffer.from(nftInfo[0].metadata).toString()
    console.log(`\n[REGISTRO] URI de metadatos on-chain: ${onChain}`)
    if (onChain !== `ipfs://${cidV1Raw(metadataBytes)}`) throw new Error('El URI on-chain no es el CID del JSON de metadatos')
    console.log('[VERIFY] El URI es el identificador de contenido de los metadatos: cualquier cambio al JSON lo cambiaría.')
    console.log('[INFO] Para que los enlaces resuelvan, sube logonft.png y los mismos bytes del JSON con `ipfs add --cid-version=1` (o un servicio de pinning); obtienen estos CIDs.')

    console.log('\n CONCEPTO CLAVE:')
    console.log('Sin HIP-412, tus NFTs aparecerán como cuadros vacíos en las billeteras.')
    console.log('La estandarización es clave para la interoperabilidad, y un identificador de contenido')
    console.log('hace evidente cualquier alteración: el URI solo coincide con los bytes exactos.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] Error de Ejecución:', error.message)
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
