/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import { TransferTransaction, Hbar, PrivateKey } from '@hiero-ledger/sdk'
import { getClient } from './config.js'

/**
 * Utilidad Dev: Recargar Operador desde Cuenta 1
 *
 * Este script envía una cantidad HARDCODEADA de HBAR desde ACCOUNT_1 de vuelta al OPERATOR.
 * Utiliza las credenciales almacenadas en tu archivo .env.
 *
 * USO:
 * node Spanish/M99_Utilities/transfer.js
 */
const main = async () => {
  const CANTIDAD_HBAR = 50 // <--- CANTIDAD HARDCODEADA

  const { client, operatorId } = getClient()

  // Cargar Cuenta 1 desde ENV
  const senderId = process.env.ACCOUNT_1_ID
  const senderKeyStr = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!senderId || !senderKeyStr) {
    console.error('❌ Falta ACCOUNT_1_ID o ACCOUNT_1_PRIVATE_KEY en el .env')
    process.exit(1)
  }

  try {
    console.log('\n=== Utilidad Dev: Recargar Operador ===')
    console.log(`Remitente:   Cuenta 1 (${senderId})`)
    console.log(`Receptor:    Operador (${operatorId} - Cliente)`)
    console.log(`Cantidad:    ${CANTIDAD_HBAR} HBAR\n`)

    const transaction = await new TransferTransaction()
      .addHbarTransfer(senderId, new Hbar(-CANTIDAD_HBAR))
      .addHbarTransfer(operatorId, new Hbar(CANTIDAD_HBAR))
      .freezeWith(client)

    const senderPrivKey = PrivateKey.fromString(senderKeyStr)
    await transaction.sign(senderPrivKey)

    const response = await transaction.execute(client)
    const receipt = await response.getReceipt(client)

    console.log(`✅ ¡Éxito! Estado de Transferencia: ${receipt.status.toString()}`)
    client.close()
  } catch (error) {
    console.error('\n❌ La transferencia falló:', error.message)
    process.exit(1)
  }
}

main()
