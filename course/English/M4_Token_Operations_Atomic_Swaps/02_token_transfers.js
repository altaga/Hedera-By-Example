/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Fungible Token Transfers (HTS)
 * [CONCEPT] Uniform Asset Architecture
 * ============================================================================
 * [ KEY CONCEPT ]
 * Moving native tokens on Hedera is as efficient as moving HBAR. You use
 * the same `TransferTransaction` object, but specify the `TokenId`. This
 * uniform architecture makes developing multi-asset applications significantly
 * simpler than systems that require multiple complex smart contract calls.
 * *
 * [ LEARNABLE MOMENT ]
 * Native HTS fungible token transfers do not require infinite allowance approvals to external smart contracts, eliminating the primary attack vector responsible for billions in DeFi wallet drain exploits.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens
 *
 * [ LEARNING PATH ]
 * - Previous: M4 Lab 01: HBAR Transfers
 * - Next:     M4 Lab 03: NFT Transfers
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Run first: M3 Lab 01 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 02_token_transfers.js
 * ============================================================================
 */

import { AccountId, TransferTransaction, TokenId } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HTS Fungible Token Transfers ---\n')

  const { client, operatorId } = getClient()
  const targetId = process.env.ACCOUNT_1_ID
  const tokenId = getState('FT_TOKEN_ID')

  if (!targetId || !tokenId) {
    console.error('[FAILED] Missing ACCOUNT_1_ID or FT_TOKEN_ID in configuration.')
    process.exitCode = 1
    console.log('[INFO] Tip: Run M3.1 to issue tokens first.')
    return
  }

  try {
    console.log(`[PROCESS] Transferring 10 HSC (Token: ${tokenId}) to ${targetId}...`)

    // Hedera allows batching multiple token transfers in one TX
    const transaction = await new TransferTransaction()
      .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(operatorId), -1000) // 10.00 HSC (decimal=2)
      .addTokenTransfer(TokenId.fromString(tokenId), AccountId.fromString(targetId), 1000)
      .freezeWith(client)

    const response = await transaction.execute(client)

    console.log(`[LOG] View on HashScan: ${getHashscanUrl(response)}`)

    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const receipt = await response.getReceipt(client)
    console.log(`\n[SUCCESS] Success! Token Transfer Status: ${receipt.status.toString()}`)

    console.log('\n KEY CONCEPT:')
    console.log('The Association Rule: The recipient MUST be associated with the token')
    console.log('to receive it. We enabled "Unlimited Auto-Association" in Module 0.3')
    console.log('to make this process seamless for this lab.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    if (error.message.includes('TOKEN_NOT_ASSOCIATED_TO_ACCOUNT')) {
      console.error('\n[FAILED] Transfer Failed: Target Account is not associated with this token.')
      process.exitCode = 1
      console.log('[INFO] Tip: Run M3.2 or perform a TokenAssociateTransaction for the child wallet.')
    } else {
      console.error('\n[FAILED] Transfer Failed:', error.message)
      process.exitCode = 1
    }
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
