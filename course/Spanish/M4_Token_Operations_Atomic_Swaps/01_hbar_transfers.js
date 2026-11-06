/**
 * ============================================================================
 * Lab 01: Transferencias Atómicas de HBAR
 * [CONCEPTO] El Libro Mayor de Suma Cero y Finalidad Definitiva
 * ============================================================================
 * [ CONCEPTO CLAVE ]
 * Integridad Matemática: El `TransferTransaction` de Hedera es un "Libro Mayor
 * de Suma Cero": la suma de todos los débitos y créditos en una sola
 * transacción debe sumar CERO. Esto es forzado por los nodos antes de
 * alcanzar el consenso. Una vez que la transferencia se procesa, alcanza
 * "Finalidad Definitiva" (Absolute Finality): a diferencia de otras redes,
 * en Hedera no hay rollbacks ni bifurcaciones de la cadena; el estado es
 * inmutable y final en segundos.
 * *
 * [ MOMENTO DE APRENDIZAJE ]
 * En cada TransferTransaction de Hedera, la suma algebraica de todas las transferencias debe ser cero. Débitos y créditos se equilibran atómicamente en consenso hasta el exacto tinybar.
 *
 * [ REFERENCIAS OFICIALES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/transfer-cryptocurrency
 *
 * [ RUTA DE APRENDIZAJE ]
 * - Anterior: M3 Lab 06: Regalías de Capa Base
 * - Actual:   M4 Lab 01: Transferencias de HBAR
 * - Siguiente: M4 Lab 02: Transferencias de Tokens
 *
 * [ ANTES DE EJECUTAR ]
 * - Wallet: tu cuenta de testnet (firma y paga las comisiones).
 * - Wallets de práctica: ACCOUNT_1 y ACCOUNT_2 (créalas en el panel Wallets de la web, o defínelas en .env).
 * - Costo: ~1 ℏ (solo comisiones de red).
 *
 * [ CÓMO EJECUTAR ]
 * node 01_hbar_transfers.js
 * ============================================================================
 */

import { AccountId, TransferTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- INICIO DEL LABORATORIO: Auditoría de Transferencias Nativas (HBAR) ---\n')

  const { client, operatorId } = getClient()
  const targetId = process.env.ACCOUNT_1_ID

  if (!targetId) {
    console.error('[FALLO] Falta el ACCOUNT_1_ID en el archivo .env.')
    process.exitCode = 1
    return
  }

  try {
    console.log(`[PROCESO] Preparando transferencia de 1 HBAR de ${operatorId} a ${targetId}...`)

    // Arma la transferencia: los débitos (negativos) y créditos (positivos) de una transacción deben sumar cero.
    const transaction = await new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(-1)) // Débito
      .addHbarTransfer(AccountId.fromString(targetId), new Hbar(1)) // Crédito
      .freezeWith(client)

    const response = await transaction.execute(client)

    console.log(`[REGISTRO] ID Transacción: ${response.transactionId.toString()}`)
    console.log(`[REGISTRO] Ver en HashScan: ${getHashscanUrl(response)}`)

    // Espera el consenso: el recibo dice si la red aceptó la transacción.
    const receipt = await response.getReceipt(client)
    console.log(`\n[ÉXITO] Transferencia confirmada por la red. Estado: ${receipt.status.toString()}`)

    console.log('\n CONCEPTO CLAVE:')
    console.log('Finalidad en el Hashgraph: A diferencia de las redes de Minería')
    console.log('(PoW), Hedera no requiere "confirmaciones múltiples". Una vez')
    console.log('que recibes el recibo con éxito, la transacción es definitiva')
    console.log('e irreversible.')

    client.close()
    console.log('\n--- SESIÓN COMPLETADA ---')
  } catch (error) {
    console.error('\n[FALLO] La transferencia de HBAR falló:', error.message)
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
