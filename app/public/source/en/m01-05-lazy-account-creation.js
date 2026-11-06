/**
 * ============================================================================
 * Lab 05: Lazy Account Creation (Account Abstraction)
 * [CONCEPT] Account Abstraction via ECDSA Aliases
 * ============================================================================
 * [ KEY CONCEPT ]
 * Traditionally on Hedera, you must pay a fee upfront to create a new account
 * for a user using `AccountCreateTransaction`.
 * With Lazy Account Creation, you simply transfer HBAR to a raw EVM address
 * (an ECDSA public key alias). Hedera automatically intercepts the transfer,
 * creates the Hedera Account behind the scenes, and deducts the creation fee
 * from the transferred amount. This is vital for onboarding Ethereum users.
 * *
 * [ LEARNABLE MOMENT ]
 * HIP-32 enables frictionless Web3 onboarding: you can send funds to an uninstantiated EVM address (0x...), and the Hedera consensus nodes will lazily spawn a hollow account on the fly waiting for the first signed transaction to bind the public key.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-32
 *
 * [ LEARNING PATH ]
 * - Previous: M1 Lab 04: Account Key Rotation
 * - Next:     M1 Lab 06: Native Staking (HIP-584)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M1_Fundamentals_Functional_JS/05_lazy_account_creation.js
 * ============================================================================
 */

import { PrivateKey, TransferTransaction, AccountId, Hbar, TransactionRecordQuery } from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Lazy Account Creation ---\n')

  const { client } = getClient()

  try {
    // 1. Generate a standard Ethereum-compatible ECDSA private key
    console.log('[PROCESS] Generating new pristine ECDSA Private Key...')
    const lazyKey = PrivateKey.generateECDSA()

    // 2. Derive the EVM Address (the "Alias")
    const evmAddress = lazyKey.publicKey.toEvmAddress()
    console.log(`[LOG] Raw EVM Address (Alias): 0x${evmAddress}`)

    // 3. Convert EVM Address string to Hedera AccountId object
    const aliasAccountId = AccountId.fromString(`0.0.${evmAddress}`)

    // 4. Transfer HBAR to the Alias to trigger auto-creation
    console.log('\n[PROCESS] Transferring 0.5 HBAR to the EVM Alias to trigger auto-creation...')
    const tx = await new TransferTransaction()
      .addHbarTransfer(client.operatorAccountId, new Hbar(-0.5))
      .addHbarTransfer(aliasAccountId, new Hbar(0.5))
      .execute(client)

    // 5. Get the receipt and the child record to reveal the newly created Account ID
    await tx.getReceipt(client)
    console.log('[SUCCESS] Transfer successful! The account was lazily created.')

    // Fetching the transaction record reveals the auto-created Hedera Account ID
    const record = await new TransactionRecordQuery()
      .setTransactionId(tx.transactionId)
      .setIncludeChildren(true)
      .execute(client)

    const childRecord = record.children[0]
    if (childRecord && childRecord.receipt.accountId) {
      console.log(`\n[LOG] Hedera assigned Account ID: ${childRecord.receipt.accountId.toString()}`)
    } else {
      console.log(`\n[INFO] Check Hashscan for the newly created Account ID mapped to 0x${evmAddress}`)
    }

    console.log('\n KEY CONCEPT:')
    console.log('You just onboarded an Ethereum wallet directly to Hedera without')
    console.log('paying the account creation fee upfront. The network automatically')
    console.log('handled the account creation during the HBAR transfer.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Execution Error:', error.message)
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
