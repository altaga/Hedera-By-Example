/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Native Account Creation
 * [ CONCEPT ] Environment Provisioning & Multi-Account Setup
 * ============================================================================
 * [ KEY CONCEPT ]
 * Treasury Independence: Using accounts other than the operator allows
 * you to see fees in action, as Hedera often exempts the treasury from
 * certain fee types.
 * *
 * [ LEARNABLE MOMENT ]
 * In enterprise deployments, never use your root treasury account to test risky smart contracts or daily operations. Programmatically spawning isolated child wallets protects master funds while enforcing dedicated association quotas.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/accounts/create-an-account
 *
 * [ LEARNING PATH ]
 * - Previous: Lab 03: Unlimited Association
 * - Next:     Lab 05: AWS KMS Enterprise Signer
 *
 * [ HOW TO RUN ]
 * node 04_create_child_wallet.js
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
      console.log(`[ℹ️ INFO] ${accountName} already exists: ${existingId}. Skipping creation.`)
      return
    }

    console.log(`[⚙️ PROCESS] Provisioning ${accountName} with 5 HBAR...`)
    const newPrivateKey = PrivateKey.generateECDSA()
    const newPublicKey = newPrivateKey.publicKey

    const tx = new AccountCreateTransaction()
      .setKeyWithoutAlias(newPublicKey)
      .setInitialBalance(Hbar.from(5))
      .setMaxAutomaticTokenAssociations(-1)
      .freezeWith(client)

    const response = await tx.execute(client)
    const receipt = await response.getReceipt(client)
    const newAccountId = receipt.accountId.toString()
    const evmAddress = '0x' + newPublicKey.toEvmAddress()

    console.log(`[ℹ️ INFO] Synchronizing ${accountName} to .env...`)
    updateEnv(`${accountName}_ID`, newAccountId)
    updateEnv(`${accountName}_EVM_ADDRESS`, evmAddress)
    updateEnv(`${accountName}_PRIVATE_KEY`, newPrivateKey.toStringDer())

    console.log(`[✅ SUCCESS] ${accountName} created: ${newAccountId}`)
  }

  try {
    // Attempt to provision both required accounts
    await provisionAccount('ACCOUNT_1')
    await provisionAccount('ACCOUNT_2')

    console.log('\n💡 KEY CONCEPT:')
    console.log('You now have three accounts: Operator (Treasury), Account 1, and Account 2.')
    console.log('This allows you to test fees and multi-party flows without being')
    console.log('exempt by the Treasury.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Provisioning Failed:', error.message)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ FAILED] Execution Error:', error.message)
    process.exit(1)
  })
}
