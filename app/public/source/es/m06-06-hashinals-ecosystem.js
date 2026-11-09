/**
 * ============================================================================
 * Lab 06: El Ecosistema Hashinals
 * [CONCEPTO] Máxima Soberanía y NFTs Nativos del Ledger
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Resiliencia Total: Un "Hashinal" representa el grado máximo de
 * descentralización. A diferencia de otros NFTs que dependen de gateways de
 * IPFS o servidores web, un Hashinal combina HTS (el token), HFS (el
 * manifiesto) y HCS (los datos binarios) en un stack on-chain, sin dependencias
 * externas. Ojo: en este lab el archivo de HFS conserva su llave y vence en 31
 * días; un activo de larga vida necesita renovar su archivo.
 * En sentido estricto, un Hashinal (HCS-5) apunta a una inscripción HCS-1
 * (hcs://1/<tópico>); este lab apunta a un archivo de HFS para mostrar la misma idea.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Los Hashinals llevan el concepto de inscripciones tipo Ordinals a Hedera con finalidad en segundos y huella de carbono despreciable, enlazando medios guardados en el ledger a números de serie de HTS.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://hashgraphonline.com/
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M6 Lab 05: Reconstrucción Trustless de Datos desde HCS-1
 * - Siguiente: M6 Lab 07: NFT Nativo HCS-1 (Metadatos + Imagen en HCS)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Ejecuta antes: Lab 01 de M6 (este lab lee lo que guardó).
 * - Costo: ~15 ℏ la primera vez (crea un token, cerca de 1 USD); <1 ℏ al volver a ejecutarlo (reutiliza lo que creó).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M6_Mass_Storage_Hashinals/06_hashinals_ecosystem.js
 * ============================================================================
 */

import {
  AccountId, PrivateKey,
  TokenCreateTransaction, TokenType,
  TokenSupplyType, TokenMintTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState, reuseToken } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Ecosistema Hashinal (On-Chain Full Stack) ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const hfsFileId = getState('HFS_FILE_ID')

  if (!hfsFileId) {
    console.error('[FALLO] Falta HFS_FILE_ID en el estado local. Ejecuta Lab 01 o 02 primero.')
    process.exitCode = 1
    return
  }

  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    const __dirname = path.dirname(import.meta.filename)
    const metaPath = path.resolve(__dirname, './assets/hedera_meta.md')
    const readmeContent = fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf8') : 'Metadatos de Syllabus'

    // 1. Crear la Colección de NFT Hashinal
    console.log("[PROCESO] Creando la colección de grado institucional 'Hedera Syllabus Hashinal'...")
    const tokenId = await reuseToken('REUSE_M6_06_TOKEN', async () => {
      // Crea el token: sus llaves (admin, supply, KYC, freeze...) deciden quién puede cambiarlo después.
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('Hedera Batch Hashinal')
        .setTokenSymbol('HASH')
        .setTokenType(TokenType.NonFungibleUnique)
        .setDecimals(0)
        .setInitialSupply(0)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100)
        .setSupplyKey(adminKey)
        .freezeWith(client)

      const tokenResponse = await tokenTx.execute(client)
      // Espera el consenso: el recibo dice si la red aceptó la transacción.
      const tokenReceipt = await tokenResponse.getReceipt(client)
      return tokenReceipt.tokenId
    })

    console.log(`[ÉXITO] Colección Hashinal anclada: ${tokenId.toString()}`)

    // 2. Definir Metadatos con Protocolo Nativo (HIP-412)
    const metadataJSON = {
      name: 'Hedera Hashinal #1',
      creator: 'Hedera Developer',
      description: 'Un artefacto digital con soberanía total respaldado por HFS.',
      image: `hedera://${hfsFileId}`,
      attributes: [
        { trait_type: 'Storage', value: 'Native HFS' }
      ],
      manifest_info: readmeContent.split('\n')[0],
      format: 'HIP412@2.0.0'
    }

    console.log('\n---  [REGISTRO] Manifiesto de Metadatos Generado ---')
    console.log(JSON.stringify(metadataJSON, null, 2))

    // 3. Emitir (Mint) el Serial vinculando el puntero HFS
    console.log(`\n[PROCESO] Realizando Mint del Serial #1 para el Hashinal ${tokenId.toString()}...`)

    // El puntero indica que los datos están en la red 1 (Mainnet=0, Testnet=1) bajo el File ID dado
    const pointer = `hedera://1/${hfsFileId}`

    // Acuña: solo la supply key puede crear nuevas unidades o seriales NFT.
    const mintTx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .addMetadata(Buffer.from(pointer))
      .freezeWith(client)

    const mintResponse = await mintTx.execute(client)
    const mintReceipt = await mintResponse.getReceipt(client)

    console.log(`\n[ÉXITO] Serial de Hashinal Emitido: ${mintReceipt.serials[0].toString()}`)
    console.log(`[REGISTRO] Ver Emisión: ${getHashscanUrl(mintResponse)}`)
    console.log(`[INFO] El NFT ahora reside perpetuamente en el ledger apuntando al Archivo HFS ${hfsFileId}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Un Hashinal es la expresión máxima de un activo digital.')
    console.log('Al eliminar dependencias de servidores externos (como AWS o')
    console.log('gateways de IPFS), el activo depende solo de la red Hedera, siempre')
    console.log('que su archivo de HFS se mantenga vigente.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] La emisión del Hashinal falló:', error.message)
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
