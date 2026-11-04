/**
 * ============================================================================
 * Laboratorio 08: Metadatos NFT HIP-412
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
 * - Anterior: M3 Lab 07: NFTs Dinámicos
 * - Siguiente: M3 Lab 09: HIP-850 Bloqueo de NFTs en Tesorería
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD); <1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node 08_hip412_metadata.js
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
import { getClient, reuseToken } from '../M99_Utilities/index.js'

/**
 * Función auxiliar para generar un JSON estrictamente compatible con HIP-412.
 */
function generateHIP412Metadata (name, image, description, attributes) {
  return {
    name,
    creator: 'Curso Hedera For Dummies',
    description,
    image, // Debe ser un URI válido (ej., ipfs://...)
    type: 'image/png',
    format: 'HIP412@2.0.0', // Requerido por el estándar
    attributes,
    properties: {
      collection: 'Serie Educativa HIP-412',
      website: 'https://hedera.com'
    }
  }
}

const main = async () => {
  console.log('--- INICIO DE SESIÓN: Metadatos HIP-412 ---')

  const { client, operatorKey, operatorId } = getClient()
  const supplyKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Generar los Metadatos JSON
    console.log('\n[PROCESO] Construyendo JSON Compatible con HIP-412...')
    const metadataObj = generateHIP412Metadata(
      'Espada Maestra HIP-412',
      'ipfs://bafkreifh3q3wxgfbsfbs5tqybbg34z62tdcugnsvf7y3c7n66n7pzybyzi', // CID de IPFS de ejemplo
      'Una espada legendaria forjada en los fuegos del consenso de Hedera.',
      [
        { trait_type: 'Ataque', value: 99 },
        { trait_type: 'Elemento', value: 'Fuego' },
        { trait_type: 'Rareza', value: 'Legendaria' }
      ]
    )

    console.log('[REGISTRO] Carga Útil HIP-412:')
    console.log(JSON.stringify(metadataObj, null, 2))

    // En una aplicación de producción real, subirías `metadataObj` a IPFS aquí
    // y usarías el CID de IPFS resultante como el búfer de metadatos.
    // Para este laboratorio, asumiremos que lo subimos y obtuvimos un CID:
    const mockCid = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/metadata.json'
    const metadataBuffer = Buffer.from(mockCid)

    // 2. Crear la Colección NFT
    console.log('\n[PROCESO] Creando Colección NFT...')
    const tokenId = await reuseToken('REUSE_M3_08_TOKEN', async () => {
      const createTx = await new TokenCreateTransaction()
        .setTokenName('Items HIP-412')
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
    let tx, signTx, submitTx, receipt // los reutilizan los pasos siguientes
    console.log(`[ÉXITO] Colección creada: ${tokenId.toString()}`)

    // 3. Mintear el NFT con el URI HIP-412
    console.log('\n[PROCESO] Minteando NFT con URI de Metadatos HIP-412...')
    tx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata([metadataBuffer])
      .freezeWith(client)

    signTx = await tx.sign(supplyKey)
    submitTx = await signTx.execute(client)
    receipt = await submitTx.getReceipt(client)
    const serialNum = receipt.serials[0].toNumber()
    console.log(`[ÉXITO] Minteado el Serie #${serialNum}`)

    // 4. Verificar
    const nftInfo = await new TokenNftInfoQuery()
      .setNftId(new NftId(tokenId, serialNum))
      .execute(client)

    console.log(`\n[REGISTRO] URI de Metadatos On-chain: ${Buffer.from(nftInfo[0].metadata).toString()}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Sin HIP-412, tus NFTs aparecerán como cuadrados en blanco en las billeteras.')
    console.log('La estandarización es crítica para la interoperabilidad del ecosistema.')

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
      console.error('[FALLO] Error de ejecución:', error.message)
      process.exit(1)
    })
}
