import { TransferTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, parsePrivateKey } from './config.js'

/**
 * Dev Utility: Refuel the Operator from Account 1
 *
 * Sends HBAR from ACCOUNT_1 back to the OPERATOR, using the credentials in your
 * .env file. The amount defaults to 10 HBAR and can be passed as an argument.
 *
 * USAGE:
 * node English/M99_Utilities/transfer.js [hbar]
 */
const main = async () => {
  const amountHbar = Number(process.argv[2] || 10)
  const { client, operatorId } = getClient()
  const senderId = process.env.ACCOUNT_1_ID
  const senderKey = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!senderId || !senderKey) {
    console.error('Missing ACCOUNT_1_ID or ACCOUNT_1_PRIVATE_KEY in .env')
    process.exit(1)
  }
  if (!(amountHbar > 0)) {
    console.error('The amount must be a positive number of HBAR.')
    process.exit(1)
  }

  try {
    console.log('\n=== Dev Utility: Refuel Operator ===')
    console.log(`Sender:   Account 1 (${senderId})`)
    console.log(`Receiver: Operator (${operatorId})`)
    console.log(`Amount:   ${amountHbar} HBAR\n`)

    const transaction = await new TransferTransaction()
      .addHbarTransfer(senderId, new Hbar(-amountHbar))
      .addHbarTransfer(operatorId, new Hbar(amountHbar))
      .freezeWith(client)
      .sign(parsePrivateKey(senderKey))

    const receipt = await (await transaction.execute(client)).getReceipt(client)
    console.log(`Success! Transfer Status: ${receipt.status.toString()}`)
  } catch (error) {
    console.error('\nTransfer Failed:', error.message)
    process.exitCode = 1
  } finally {
    client.close()
  }
}

main()
