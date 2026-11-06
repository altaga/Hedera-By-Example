import { TransferTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, parsePrivateKey } from './config.js'

/**
 * Utilidad de Desarrollo: Recargar al Operador desde la Cuenta 1
 *
 * Envía HBAR de ACCOUNT_1 de vuelta al OPERADOR, con las credenciales de tu
 * archivo .env. El monto por defecto es 10 HBAR y se puede pasar como argumento.
 *
 * USO:
 * node Spanish/M99_Utilities/transfer.js [hbar]
 */
const main = async () => {
  const amountHbar = Number(process.argv[2] || 10)
  const { client, operatorId } = getClient()
  const senderId = process.env.ACCOUNT_1_ID
  const senderKey = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!senderId || !senderKey) {
    console.error('Falta ACCOUNT_1_ID o ACCOUNT_1_PRIVATE_KEY en el .env')
    process.exit(1)
  }
  if (!(amountHbar > 0)) {
    console.error('El monto debe ser un número positivo de HBAR.')
    process.exit(1)
  }

  try {
    console.log('\n=== Utilidad de Desarrollo: Recargar al Operador ===')
    console.log(`Remitente: Cuenta 1 (${senderId})`)
    console.log(`Receptor:  Operador (${operatorId})`)
    console.log(`Monto:     ${amountHbar} HBAR\n`)

    const transaction = await new TransferTransaction()
      .addHbarTransfer(senderId, new Hbar(-amountHbar))
      .addHbarTransfer(operatorId, new Hbar(amountHbar))
      .freezeWith(client)
      .sign(parsePrivateKey(senderKey))

    const receipt = await (await transaction.execute(client)).getReceipt(client)
    console.log(`¡Listo! Estado de la transferencia: ${receipt.status.toString()}`)
  } catch (error) {
    console.error('\nFalló la transferencia:', error.message)
    process.exitCode = 1
  } finally {
    client.close()
  }
}

main()
