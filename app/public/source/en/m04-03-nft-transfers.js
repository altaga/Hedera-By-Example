/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: NFT Transfers (Ownership Change)
 * [ CONCEPT ] Unique Digital Inheritance
 * ============================================================================
 * [ KEY CONCEPT ]
 * True Ownership: Once this transaction is successfully processed, the
 * record of ownership is updated in the network's consensus state. Unlike
 * a central database, no administrator can reverse this transfer. While
 * fungible tokens move by "Amount", NFTs move by "Serial Number".
 * *
 * [ LEARNABLE MOMENT ]
 * NFT transfers track discrete serial numbers rather than balances. Always confirm that recipient wallets have sufficient auto-association slots or have pre-associated the target token class to prevent transfer failure.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens#transfer-nfts
 *
 * [ LEARNING PATH ]
 * - Previous: M4 Lab 02: Token Transfers
 * - Next:     M4 Lab 04: Atomic Swaps
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Run first: M3 Lab 03 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 03_nft_transfers.js
 * ============================================================================
 */

import { AccountId, NftId, TransferTransaction, TokenId } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState, findOwnedSerial } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HTS NFT Transfers ---\n')

  const { client, operatorId } = getClient()
  const targetId = process.env.ACCOUNT_1_ID
  const tokenId = getState('NFT_TOKEN_ID')

  if (!targetId || !tokenId) {
    console.error('[❌ FAILED] Missing ACCOUNT_1_ID or NFT_TOKEN_ID in configuration.')
    process.exitCode = 1
    console.log('[ℹ️ INFO] Tip: Run M3.3 to issue an NFT collection first.')
    return
  }

  try {
    // The lowest serial the operator still holds (serial #1 may be gone after earlier runs).
    const serial = await findOwnedSerial(tokenId, operatorId)
    if (!serial) {
      console.error(`[❌ FAILED] ${operatorId} holds no serial of ${tokenId}. Run M3 Lab 03 to mint more.`)
      process.exitCode = 1
      return
    }
    console.log(`[⚙️ PROCESS] Transferring NFT ${tokenId} Serial #${serial} to ${targetId}...`)

    // Build the transfer: debits (negative) and credits (positive) in one transaction must add up to zero.
    const transaction = await new TransferTransaction()
      .addNftTransfer(new NftId(TokenId.fromString(tokenId), serial), AccountId.fromString(operatorId), AccountId.fromString(targetId))
      .freezeWith(client)

    const response = await transaction.execute(client)

    console.log(`[📊 LOG] View on HashScan: ${getHashscanUrl(response)}`)

    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const receipt = await response.getReceipt(client)
    console.log(`\n[✅ SUCCESS] Success! NFT Transfer Status: ${receipt.status.toString()}`)

    console.log('\n💡 KEY CONCEPT:')
    console.log('True Ownership: Once this transaction is successfully processed, the')
    console.log("record of ownership is updated in the network's consensus state. No")
    console.log('central database can reverse this transfer.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    if (error.message.includes('TOKEN_NOT_ASSOCIATED_TO_ACCOUNT')) {
      console.error('\n[❌ FAILED] Transfer Failed: Target Account is not associated with this NFT collection.')
      process.exitCode = 1
      console.log('[ℹ️ INFO] Tip: Run M3.2 or perform a TokenAssociateTransaction for the child wallet.')
    } else {
      console.error('\n[❌ FAILED] Transfer Failed:', error.message)
      process.exitCode = 1
    }
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
