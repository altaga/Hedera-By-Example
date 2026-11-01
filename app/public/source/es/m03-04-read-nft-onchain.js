/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Resolución de Metadatos NFT On-Chain
 * [ CONCEPTO ] Verificación sin Confianza (Trustless Verification)
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Auditoría Total: En un sistema descentralizado, cualquier observador debe
 * ser capaz de verificar la autenticidad de un activo. Este script realiza
 * el flujo inverso: consulta el Mirror Node para obtener el puntero de
 * metadatos (`hedera://`), descarga el JSON desde el HFS y lo decodifica.
 * Esto prueba que los metadatos de tu NFT son permanentes y no han sido
 * alterados, eliminando la necesidad de confiar en un servidor central.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Consultar metadatos de NFTs vía Mirror Nodes evita pagar comisiones de consulta a los nodos de consenso. Los Mirror Nodes decodifican y cachean los bytes, ofreciendo endpoints REST inmediatos para billeteras y mercados.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/rest-api#get-nft-info
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M3 Lab 03: NFTs con HIP-412
 * - Actual:   M3 Lab 04: Lectura de NFTs
 * - Siguiente: M3 Lab 05: Tarifas Personalizadas
 *
 * [ CÓMO EJECUTAR ]
 * node 04_read_nft_onchain.js
 * ============================================================================
 */

import {
  FileContentsQuery, NftId, TokenId, TokenNftInfoQuery
} from '@hiero-ledger/sdk'
import { getClient, getState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Metadatos Inmutable ---\n')

  // Recuperar el Token ID generado en el laboratorio anterior (o usar uno manual)
  const TOKEN_ID = getState('NFT_TOKEN_ID') || '0.0.8690406'
  const SERIAL_NUMBER = 1

  const { client } = getClient()

  try {
    // Paso 1: Consultar la información del NFT para obtener el puntero de metadatos
    console.log(`[⚙️ PROCESO] Consultando registro on-chain para Token ${TOKEN_ID}, Serial #${SERIAL_NUMBER}...`)
    const nftId = new NftId(TokenId.fromString(TOKEN_ID), SERIAL_NUMBER)

    const nftInfos = await new TokenNftInfoQuery()
      .setNftId(nftId)
      .execute(client)

    if (nftInfos.length === 0) {
      throw new Error(`NFT no encontrado para el Token ${TOKEN_ID}.`)
    }

    const nftInfo = nftInfos[0]
    const metadataPointer = Buffer.from(nftInfo.metadata).toString('utf8')
    console.log(`[📊 REGISTRO] Puntero (Metadata URI): ${metadataPointer}`)

    // Paso 2: Extraer el File ID del formato 'hedera://'
    console.log('[⚙️ PROCESO] Resolviendo URI de protocolo nativo...')
    let fileIdString = metadataPointer

    if (metadataPointer.includes('hedera://')) {
      const parts = metadataPointer.split('/')
      fileIdString = parts[parts.length - 1]
    }
    console.log(`[📊 REGISTRO] File ID Resolucionado: ${fileIdString}`)

    // Paso 3: Consultar HFS para descargar el JSON de metadatos
    console.log(`[⚙️ PROCESO] Descargando JSON de metadatos desde el Archivo HFS: ${fileIdString}...`)
    const fileContents = await new FileContentsQuery()
      .setFileId(fileIdString)
      .execute(client)

    const jsonString = Buffer.from(fileContents).toString('utf8')
    const metadataObj = JSON.parse(jsonString)

    // Paso 4: Mostrar los resultados finales
    console.log('\n--- 💎 [✅ ÉXITO] METADATOS ON-CHAIN DECODIFICADOS ---')
    console.log(`[📊 REGISTRO] Nombre:        ${metadataObj.name}`)
    console.log(`[📊 REGISTRO] Creador:       ${metadataObj.creator}`)
    console.log(`[📊 REGISTRO] Descripción:   ${metadataObj.description}`)
    console.log(`[📊 REGISTRO] Recurso Image: ${metadataObj.image}`)
    console.log('---------------------------------------------------------')

    console.log('\n[ℹ️ INFO] Objeto JSON Final:')
    console.log(JSON.stringify(metadataObj, null, 2))

    console.log('\n💡 CONCEPTO CLAVE:')
    console.log('Cualquier observador externo puede ejecutar este script para')
    console.log('verificar la autenticidad e integridad del activo digital,')
    console.log('garantizando una "Verificación sin Confianza" (Trustless).')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[❌ FALLO] La resolución de metadatos falló:', error.message)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ FALLO] Error de Ejecución:', error.message)
    process.exit(1)
  })
}
