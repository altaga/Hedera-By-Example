/**
 * ============================================================================
 * Lab 04: Native Account Creation
 * [CONCEPT] Environment Provisioning & Multi-Account Setup
 * ============================================================================
 * [ KEY CONCEPT ]
 * Treasury Independence: Using accounts other than the operator allows
 * you to see fees in action: token custom fees, for example, are never
 * charged to a token's treasury or to its fee collectors.
 *
 *
 * [ LEARNABLE MOMENT ]
 * In enterprise deployments, never use your root treasury account to test risky smart contracts or daily operations. Programmatically spawning isolated child wallets protects master funds while enforcing dedicated association quotas.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/native/accounts/create
 *
 * [ LEARNING PATH ]
 * - Previous: M0 Lab 03: Activate Unlimited Auto-Associations
 * - Next:     M0 Lab 05: AWS KMS Enterprise Signer
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M0_Setup_and_Test/04_create_child_wallet.js
 * ============================================================================
 */

import { AccountCreateTransaction, Hbar, PrivateKey } from '@hiero-ledger/sdk'
import { getClient, updateEnv } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Environment Provisioning ---\n')

  const { client } = getClient()

  // Function to provision a specific account if missing
  const provisionAccount = async (accountName) => {
    const existingId = process.env[`${accountName}_ID`]

    if (existingId) {
      console.log(`[INFO] ${accountName} already exists: ${existingId}. Skipping creation.`)
      return
    }

    console.log(`[PROCESS] Provisioning ${accountName} with 1 HBAR...`)
    // Generate a key locally: the private key never leaves this process.
    const newPrivateKey = PrivateKey.generateECDSA()
    const newPublicKey = newPrivateKey.publicKey

    // Create an account: its key controls it; the initial balance comes from the payer.
    const tx = new AccountCreateTransaction()
      .setKeyWithoutAlias(newPublicKey)
      .setInitialBalance(Hbar.from(1))
      .setMaxAutomaticTokenAssociations(-1)
      .freezeWith(client)

    const response = await tx.execute(client)
    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const receipt = await response.getReceipt(client)
    const newAccountId = receipt.accountId.toString()
    const evmAddress = '0x' + newPublicKey.toEvmAddress()

    console.log(`[INFO] Synchronizing ${accountName} to .env...`)
    updateEnv(`${accountName}_ID`, newAccountId)
    updateEnv(`${accountName}_EVM_ADDRESS`, evmAddress)
    updateEnv(`${accountName}_PRIVATE_KEY`, newPrivateKey.toStringDer())

    console.log(`[SUCCESS] ${accountName} created: ${newAccountId}`)
  }

  try {
    // Attempt to provision both required accounts
    await provisionAccount('ACCOUNT_1')
    await provisionAccount('ACCOUNT_2')

    console.log('\n KEY CONCEPT:')
    console.log('You now have three accounts: Operator (Treasury), Account 1, and Account 2.')
    console.log('This lets you test fees and multi-party flows from accounts that are not')
    console.log('the token treasury, so custom-fee exemptions do not hide the fees.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Provisioning Failed:', error.message)
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
