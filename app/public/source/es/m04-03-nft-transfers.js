/**
 * ============================================================================
 * Lab 03: Transferencias de NFT (Propiedad por Número de Serie)
 * [CONCEPTO] Granularidad de Activos Únicos e Identidad Compuesta
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Identidad Inequívoca: A diferencia de los tokens fungibles, cada unidad de
 * una colección NFT en Hedera tiene su propia identidad: el Número de Serie.
 * El ledger no solo rastrea quién tiene el token, sino que rastrea
 * explícitamente el par (TokenId + Serial) → AccountId. Esta granularidad
 * nativa elimina ambigüedades en la propiedad, permitiendo que el Serial #1
 * sea un activo totalmente distinto al Serial #2, base fundamental de los
 * mercados de coleccionables digitales.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las transferencias de NFTs operan por números de serie específicos y no por saldos. Confirma siempre que la billetera receptora tenga slots de auto-asociación suficientes para evitar que la transacción sea rechazada.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens#transfer-nfts
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M4 Lab 02: Transferencias de Tokens
 * - Actual:   M4 Lab 03: Transferencias de NFTs
 * - Siguiente: M4 Lab 04: Swaps Atómicos
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Ejecuta antes: Lab 03 de M3 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 03_nft_transfers.js
 * ============================================================================
 */

import { AccountId, NftId, TransferTransaction, TokenId } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState, findOwnedSerial } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Transferencia de Activos Únicos ---\n')

  const { client, operatorId } = getClient()
  const targetId = process.env.ACCOUNT_1_ID
  const tokenId = getState('NFT_TOKEN_ID')

  if (!targetId || !tokenId) {
    console.error('[FALLO] Falta NFT_TOKEN_ID en el estado o ACCOUNT_1 en el .env.')
    process.exitCode = 1
    return
  }

  try {
    // El menor serial que el operador todavía tiene (el #1 puede haberse enviado en una ejecución anterior).
    const serial = await findOwnedSerial(tokenId, operatorId)
    if (!serial) {
      console.error(`[FALLO] ${operatorId} no tiene ningún serial de ${tokenId}. Ejecuta el Lab 03 de M3 para acuñar más.`)
      process.exitCode = 1
      return
    }
    console.log(`[PROCESO] Transfiriendo NFT ${tokenId} Serial #${serial} a ${targetId}...`)

    // Arma la transferencia: los débitos (negativos) y créditos (positivos) de una transacción deben sumar cero.
    const transaction = await new TransferTransaction()
      .addNftTransfer(
        new NftId(TokenId.fromString(tokenId), serial),
        AccountId.fromString(operatorId),
        AccountId.fromString(targetId)
      )
      .freezeWith(client)

    const response = await transaction.execute(client)

    console.log(`[REGISTRO] ID Transacción: ${response.transactionId.toString()}`)
    console.log(`[REGISTRO] Ver en HashScan: ${getHashscanUrl(response)}`)

    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const receipt = await response.getReceipt(client)
    console.log(`\n[ÉXITO] Propiedad del serial transferida con éxito. Estado: ${receipt.status.toString()}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('El par (Token ID + Serial) es el identificador definitivo en el')
    console.log('ledger. Al ser una operación nativa de HTS, la transferencia')
    console.log('ocurre con finalidad absoluta, garantizando que el nuevo dueño')
    console.log('tenga control total sobre el activo de forma inmediata.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    if (error.message.includes('TOKEN_NOT_ASSOCIATED_TO_ACCOUNT')) {
      console.error('\n[FALLO] Fallo por falta de Asociación: El receptor no acepta esta colección NFT.')
      process.exitCode = 1
      console.log('[TIP] Asegúrate de que ACCOUNT_1 esté asociada a la colección NFT en M3 o M0.')
    } else {
      console.error('\n[FALLO] La transferencia del NFT falló:', error.message)
      process.exitCode = 1
    }
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
