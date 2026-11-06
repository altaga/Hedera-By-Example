/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Atomic Swaps (Multi-Asset Exchange)
 * [CONCEPT] Trustless Multi-Party Settlement
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Multi-Signer Flow: Because both parties are giving up assets, both
 * must cryptographically sign the transaction. The Hedera network ensures
 * that *either both movements happen* or *neither happens*. This solves
 * the "Who goes first?" problem without requiring a middleman or complex escrow contract.
 * *
 * [ LEARNABLE MOMENT ]
 * By packing multi-token and HBAR legs into a single TransferTransaction, Hedera executes multi-party atomic swaps natively without escrow smart contracts, intermediary custodial risks, or counterparty settlement delays.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/transfer-tokens#atomic-crypto-and-token-transfers
 *
 * [ LEARNING PATH ]
 * - Previous: M4 Lab 03: NFT Transfers
 * - Next:     M4 Lab 05: Parallel Transfers
 *
 * [SEQUENCE]
 * Treasury -> Buyer: NFT #1
 * Buyer -> Treasury: HBAR payment
 * Note Hedera: Both legs in ONE TransferTransaction, signed by both
 * Hedera -> Treasury: All legs settle together or none do
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Run first: M3 Lab 03 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 04_atomic_swaps.js
 * ============================================================================
 */

import { AccountId, PrivateKey, TransferTransaction, TokenId, NftId, Hbar } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState, findOwnedSerial } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Atomic Swap Simulation ---\n')

  const { client, operatorId } = getClient()
  const userId = process.env.ACCOUNT_1_ID
  const userKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const nftTokenId = getState('NFT_TOKEN_ID')

  if (!userId || !userKey || !nftTokenId) {
    console.error('[FAILED] Missing ACCOUNT_1_ID, ACCOUNT_1_PRIVATE_KEY, or NFT_TOKEN_ID in configuration.')
    process.exitCode = 1
    return
  }

  const userPrivKey = PrivateKey.fromString(userKey)

  try {
    // The lowest serial the operator still holds (serial #1 may be gone after earlier runs).
    const serial = await findOwnedSerial(nftTokenId, operatorId)
    if (!serial) {
      console.error(`[FAILED] ${operatorId} holds no serial of ${nftTokenId}. Run M3 Lab 03 to mint more.`)
      process.exitCode = 1
      return
    }
    console.log('[PROCESS] Initiating Atomic Swap (Primary Sale Simulation):')
    console.log(`└─ Operator (Seller) sends NFT Serial #${serial} -> User (Buyer)`)
    console.log('└─ User (Buyer) sends 1 HBAR -> Operator (Seller)')

    // A single TransferTransaction can hold dozens of atomic movements
    const transaction = await new TransferTransaction()
      // 1. Move the NFT (Operator -> User)
      .addNftTransfer(new NftId(TokenId.fromString(nftTokenId), serial), AccountId.fromString(operatorId), AccountId.fromString(userId))

      // 2. Move HBAR (User -> Operator)
      .addHbarTransfer(AccountId.fromString(userId), new Hbar(-1))
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(1))

      .freezeWith(client)

    // BOTH parties must sign because both are giving up assets
    console.log('[INFO] Collecting signatures from both parties...')
    await transaction.sign(userPrivKey)
    // Operator signs automatically upon execution as they are the payer

    const response = await transaction.execute(client)

    console.log(`[LOG] View on HashScan: ${getHashscanUrl(response)}`)

    const receipt = await response.getReceipt(client)
    console.log(`\n[SUCCESS] Success! Atomic Swap Status: ${receipt.status.toString()}`)
    console.log('[INFO] Ownership and HBAR have been exchanged atomically in one block.')

    console.log('\n KEY CONCEPT:')
    console.log('The Multi-Signer Flow: Because both parties are giving up assets, both')
    console.log('must sign the transaction. The Hedera SDK handles collecting these')
    console.log('signatures before the transaction is executed.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Atomic Swap Failed:', error.message)
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
