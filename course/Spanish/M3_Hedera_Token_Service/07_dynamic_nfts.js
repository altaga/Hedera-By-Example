/**
 * ============================================================================
 * Lab 07: NFTs Dinámicos (HIP-657)
 * [CONCEPTO] Metadatos Mutables en HTS
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Históricamente, los NFTs en Hedera eran estrictamente inmutables una vez
 * minteados. Con la HIP-657, los desarrolladores pueden asignar una `metadataKey`
 * a una colección de tokens. Esto permite al poseedor de la llave usar
 * `TokenUpdateNftsTransaction` para alterar los metadatos de números de serie
 * específicos DESPUÉS de haber sido minteados. Esto habilita NFTs dinámicos
 * (ej., subir de nivel una espada en un RPG, cambiar la propiedad de bienes
 * raíces, o actualizar una insignia de identidad descentralizada).
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * La metadataKey de HIP-657 brinda mutabilidad controlada para activos digitales vivos: sistemas autorizados pueden evolucionar atributos de personajes, actualizar puntajes o reflejar valuaciones de RWAs sin re-acuñar.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hips.hedera.com/hip/hip-657
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M3 Lab 06: Regalías en la Capa Base
 * - Siguiente: M3 Lab 08: Metadatos NFT HIP-412
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD); <1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M3_Hedera_Token_Service/07_dynamic_nfts.js
 * ============================================================================
 */

import {
  NftId,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TokenMintTransaction,
  TokenUpdateNftsTransaction,
  TokenNftInfoQuery,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DE SESIÓN: NFTs Dinámicos ---\n')

  const { client, operatorKey, operatorId } = getClient()
  const supplyKey = PrivateKey.fromString(operatorKey)
  // Usaremos la misma llave como metadataKey por simplicidad
  const metadataKey = supplyKey

  try {
    // 1. Crear una Colección NFT CON una Metadata Key
    console.log('[PROCESO] Creando Colección de NFT Dinámicos...')
    const tokenId = await reuseToken('REUSE_M3_07_TOKEN', async () => {
      const createTx = await new TokenCreateTransaction()
        .setTokenName('Espadas Dinamicas')
        .setTokenSymbol('ESPADA')
        .setTokenType(TokenType.NonFungibleUnique)
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(supplyKey)
        // ESTE ES EL SECRETO PARA LOS NFTs DINÁMICOS:
        .setMetadataKey(metadataKey)
        .freezeWith(client)
      const signed = await createTx.sign(supplyKey)
      return (await (await signed.execute(client)).getReceipt(client)).tokenId
    }, { check: (t) => !!t.metadata_key })
    let tx, signTx, submitTx // los reutilizan los pasos siguientes

    console.log(`[ÉXITO] ¡Colección creada! ID del Token: ${tokenId.toString()}`)

    // 2. Mintear un NFT estático de Nivel 1
    console.log('\n[PROCESO] Minteando una Espada de Nivel 1...')
    const metadataLevel1 = Buffer.from('ipfs://bafkreihq.../nivel1.json')

    tx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata([metadataLevel1])
      .freezeWith(client)

    signTx = await tx.sign(supplyKey)
    submitTx = await signTx.execute(client)
    const receipt = await submitTx.getReceipt(client)
    const serialNum = receipt.serials[0].toNumber()

    console.log(`[ÉXITO] Minteado el Serie #${serialNum}`)

    // 3. Consultar los metadatos actuales
    let nftInfo = await new TokenNftInfoQuery()
      .setNftId(new NftId(tokenId, serialNum))
      .execute(client)
    console.log(`[REGISTRO] Metadatos Iniciales: ${Buffer.from(nftInfo[0].metadata).toString()}`)

    // 4. Actualizar los metadatos del NFT (¡Subir de nivel!)
    console.log('\n[PROCESO] El jugador derrotó al jefe. Subiendo la Espada a Nivel 2...')
    const metadataLevel2 = Buffer.from('ipfs://bafybeig.../nivel2.json')

    tx = await new TokenUpdateNftsTransaction()
      .setTokenId(tokenId)
      .setSerialNumbers([serialNum])
      .setMetadata(metadataLevel2)
      .freezeWith(client)

    // Debe ser firmado por la Metadata Key
    signTx = await tx.sign(metadataKey)
    submitTx = await signTx.execute(client)
    await submitTx.getReceipt(client)

    console.log('[ÉXITO] ¡Metadatos del NFT mutados on-chain!')

    // 5. Consultar para demostrar que los metadatos cambiaron
    nftInfo = await new TokenNftInfoQuery()
      .setNftId(new NftId(tokenId, serialNum))
      .execute(client)
    console.log(`[REGISTRO] Nuevos Metadatos: ${Buffer.from(nftInfo[0].metadata).toString()}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Los NFTs Dinámicos abren nuevos paradigmas para videojuegos, cadenas de')
    console.log('suministro y boletaje. Hedera lo hace en la capa base: solo la metadataKey')
    console.log('puede cambiar la metadata, sin un contrato inteligente de por medio.')

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
