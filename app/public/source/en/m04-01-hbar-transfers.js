/**
 * ============================================================================
 * Lab 01: Native HBAR Transfers
 * [CONCEPT] Peer-to-Peer Atomic Value Exchange
 * ============================================================================
 * [ KEY CONCEPT ]
 * Finality: Unlike a blockchain where you wait for "confirmations", a
 * Hedera transfer is final in ~3-5 seconds. Once the nodes reach consensus,
 * the money has moved and cannot be reversed. This is "Real-Time Gross Settlement"
 * for the internet era.
 *
 *
 * [ LEARNABLE MOMENT ]
 * In every Hedera TransferTransaction, the algebraic sum of all transfer amounts must equal zero. Debits and credits are balanced atomically at consensus down to the exact tinybar.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/cryptocurrency/transfer-cryptocurrency
 *
 * [ LEARNING PATH ]
 * - Previous: M3 Lab 06: Base Layer Royalties
 * - Next:     M4 Lab 02: Token Transfers
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: ~1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 01_hbar_transfers.js
 * ============================================================================
 */

import { AccountId, TransferTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Native HBAR Transfers ---\n')

  const { client, operatorId } = getClient()
  const targetId = process.env.ACCOUNT_1_ID

  if (!targetId) {
    console.error('[FAILED] Missing ACCOUNT_1_ID in .env.')
    process.exitCode = 1
    return
  }

  try {
    console.log(`[PROCESS] Transferring 1 HBAR from ${operatorId} to ${targetId}...`)

    // Build the transfer: debits (negative) and credits (positive) in one transaction must add up to zero.
    const transaction = await new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(-1)) // Negative = Deduct
      .addHbarTransfer(AccountId.fromString(targetId), new Hbar(1)) // Positive = Credit
      .freezeWith(client)

    const response = await transaction.execute(client)

    console.log(`[LOG] View on HashScan: ${getHashscanUrl(response)}`)

    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const receipt = await response.getReceipt(client)
    console.log(`\n[SUCCESS] Success! Transfer Status: ${receipt.status.toString()}`)

    console.log('\n KEY CONCEPT:')
    console.log('Finality: Unlike a blockchain where you wait for "confirmations", a')
    console.log('Hedera transfer is final in ~3-5 seconds. Once the nodes reach')
    console.log('consensus, the money has moved and cannot be reversed.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Transfer Failed:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
