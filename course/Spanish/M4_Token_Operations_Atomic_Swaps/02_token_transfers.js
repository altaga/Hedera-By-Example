/**
 * ============================================================================
 * Lab 02: Transferencias de Tokens Fungibles
 * [CONCEPTO] Arquitectura de Asociación y Protección Anti-Spam
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Blindaje contra Spam: En Hedera, no puedes recibir un token si no estás
 * "Asociado" a él. Este es un mecanismo de protección nativo que evita que
 * actores maliciosos llenen tu billetera con activos no solicitados (spam) o
 * incrementen artificialmente tus costos de almacenamiento. Para una
 * experiencia sin fricción, puedes habilitar la auto-asociación ilimitada
 * (`setMaxAutomaticTokenAssociations(-1)`), permitiendo recibir cualquier
 * activo de forma automática.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * Las transferencias nativas de tokens fungibles HTS no requieren aprobaciones de saldo infinito a smart contracts, eliminando el principal vector de ataque responsable de miles de millones en robos de billeteras DeFi.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior:  M4 Lab 01: Transferencias Atómicas de HBAR
 * - Siguiente: M4 Lab 03: Transferencias de NFT (Propiedad por Número de Serie)
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Ejecuta antes: Lab 01 de M3 (este lab lee lo que guardó).
 * - Costo: <0.1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node Spanish/M4_Token_Operations_Atomic_Swaps/02_token_transfers.js
 * ============================================================================
 */

import { AccountId, TransferTransaction, TokenId } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Transferencias de Tokens (HTS) ---\n')

  const { client, operatorId } = getClient()
  const targetId = process.env.ACCOUNT_1_ID
  const tokenId = getState('FT_TOKEN_ID')

  if (!targetId || !tokenId) {
    console.error('[FALLO] Falta FT_TOKEN_ID en el estado o ACCOUNT_1 en el .env.')
    process.exitCode = 1
    return
  }

  try {
    console.log(`[PROCESO] Transfiriendo 10 HSC (Token: ${tokenId}) a ${targetId}...`)

    // Hedera permite agrupar múltiples transferencias de activos en la misma transacción
    const transaction = await new TransferTransaction()
      .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(operatorId), -1000) // 10.00 HSC (decimal=2)
      .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(targetId), 1000)
      .freezeWith(client)

    const response = await transaction.execute(client)

    console.log(`[REGISTRO] ID Transacción: ${response.transactionId.toString()}`)
    console.log(`[REGISTRO] Ver en HashScan: ${getHashscanUrl(response)}`)

    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const receipt = await response.getReceipt(client)
    console.log(`\n[ÉXITO] Transferencia confirmada por la red. Estado: ${receipt.status.toString()}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('La "Asociación" es una declaración de consentimiento. Al estar')
    console.log('integrada en el protocolo, garantiza que el usuario siempre tenga')
    console.log('el control sobre qué activos residen en su billetera, a diferencia')
    console.log('de otras redes donde el "airdrop spam" es incontrolable.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    if (error.message.includes('TOKEN_NOT_ASSOCIATED_TO_ACCOUNT')) {
      console.error('\n[FALLO] Fallo por falta de Asociación: La cuenta receptora no acepta este token.')
      process.exitCode = 1
      console.log('[TIP] Asegúrate de haber ejecutado el M0 Lab 03 o una asociación manual.')
    } else {
      console.error('\n[FALLO] La transferencia de tokens falló:', error.message)
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
