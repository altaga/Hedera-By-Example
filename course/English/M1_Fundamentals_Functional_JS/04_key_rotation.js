/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Account Key Rotation
 * [ CONCEPT ] Identity Decoupling & Authority Handover
 * ============================================================================
 * [ KEY CONCEPT ]
 * Security Hygiene: Regular key rotation is an industry standard for systems
 * handling high-value assets. This script shows how to handle the "Handover"
 * by signing the update with both the old and new keys to prove continuous
 * authority. On Hedera, your Account ID remains stable while your keys change.
 * *
 * [ LEARNABLE MOMENT ]
 * On Ethereum, if your private key is leaked, your account address is permanently lost. On Hedera, you can execute an AccountUpdateTransaction to rotate the private key while retaining the exact same Account ID and asset balances.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/accounts/update-an-account
 *
 * [ LEARNING PATH ]
 * - Previous: M1 Lab 03: Cryptography & KMS
 * - Next:     M2 Lab 01: Sync Deprecation
 *
 * [ HOW TO RUN ]
 * node 04_key_rotation.js
 * ============================================================================
 */

import { AccountId, PrivateKey, AccountUpdateTransaction } from '@hiero-ledger/sdk'
import { getClient, updateEnv } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Account Key Rotation & Sync ---\n')

  const { client } = getClient()
  const targetId = process.env.ACCOUNT_1_ID
  const targetKey = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!targetId || !targetKey) {
    console.error('[❌ FAILED] Missing required credentials in .env (ACCOUNT_1).')
    return
  }

  try {
    const oldPrivateKey = PrivateKey.fromString(targetKey)

    // 2. Generate the NEW replacement key
    console.log(`[⚙️ PROCESS] Spawning NEW replacement key for Account: ${targetId}...`)
    const newPrivateKey = PrivateKey.generateECDSA()
    const newPublicKey = newPrivateKey.publicKey
    const newKeyStr = newPrivateKey.toStringDer()

    // 3. Prepare and Execute the Update Transaction
    console.log('[⚙️ PROCESS] Constructing AccountUpdateTransaction...')
    const transaction = await new AccountUpdateTransaction()
      .setAccountId(AccountId.fromString(targetId))
      .setKey(newPublicKey)
      .freezeWith(client)

    // Dual signing required: Old key (authority) + New key (proof of ownership)
    console.log('[ℹ️ INFO] Dual signing required: Authorizing with OLD key + Proving ownership of NEW key...')
    await transaction.sign(oldPrivateKey)
    await transaction.sign(newPrivateKey)

    const response = await transaction.execute(client)
    const receipt = await response.getReceipt(client)

    console.log(`\n[✅ SUCCESS] On-Chain Success! Key Rotation Status: ${receipt.status.toString()}`)

    // 4. AUTO-SYNC: Update the .env file using the project-standard strategy
    console.log('[⚙️ PROCESS] Synchronizing .env with new account credentials...')
    updateEnv('ACCOUNT_1_PRIVATE_KEY', newKeyStr)
    updateEnv('ACCOUNT_1_EVM_ADDRESS', '0x' + newPublicKey.toEvmAddress())

    console.log('[✅ SUCCESS] Environment successfully synchronized.')
    console.log(`[📊 LOG] NEW PRIVATE KEY: ${newKeyStr}`)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Security Hygiene: Regular key rotation is an industry standard for')
    console.log('systems handling high-value assets. This script shows how to handle')
    console.log('the "Handover" by signing the update with both the old and new keys to')
    console.log('prove continuous authority.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Key Rotation Failed:', error.message)
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

export { updateEnv }
