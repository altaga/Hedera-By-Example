/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
import { TransferTransaction, Hbar, PrivateKey } from '@hiero-ledger/sdk'
import { getClient } from './config.js'

/**
 * Dev Utility: Refuel Operator from Account 1
 *
 * This script sends a HARDCODED amount of HBAR from ACCOUNT_1 back to the OPERATOR.
 * It uses the credentials stored in your .env file.
 *
 * USAGE:
 * node English/M99_Utilities/transfer.js
 */
const main = async () => {
  const AMOUNT_HBAR = 100 // <--- HARDCODED AMOUNT

  const { client, operatorId } = getClient()

  // Load Account 1 from ENV
  const senderId = process.env.OPERATOR_ID
  const senderKeyStr = process.env.OPERATOR_PRIVATE_KEY
  const receiverId = process.env.ACCOUNT_1_ID

  if (!senderId || !senderKeyStr || !receiverId) {
    console.error('❌ Missing senderID or senderKeyStr in .env')
    process.exit(1)
  }

  try {
    console.log('\n=== Dev Utility: Refuel Operator ===')
    console.log(`Sender:   Account 1 (${senderId})`)
    console.log(`Receiver: Operator (${operatorId} - Client)`)
    console.log(`Amount:   ${AMOUNT_HBAR} HBAR\n`)

    const transaction = await new TransferTransaction()
      .addHbarTransfer(senderId, new Hbar(-AMOUNT_HBAR))
      .addHbarTransfer(receiverId, new Hbar(AMOUNT_HBAR))
      .freezeWith(client)

    const senderPrivKey = PrivateKey.fromString(senderKeyStr)
    await transaction.sign(senderPrivKey)

    const response = await transaction.execute(client)
    const receipt = await response.getReceipt(client)

    console.log(`✅ Success! Transfer Status: ${receipt.status.toString()}`)
    client.close()
  } catch (error) {
    console.error('\n❌ Transfer Failed:', error.message)
    process.exit(1)
  }
}

main()
