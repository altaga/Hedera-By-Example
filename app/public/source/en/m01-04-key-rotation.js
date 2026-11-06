/**
 * ============================================================================
 * Lab 04: Account Key Rotation
 * [CONCEPT] Identity Decoupling & Authority Handover
 * ============================================================================
 * [ KEY CONCEPT ]
 * Security Hygiene: Regular key rotation is an industry standard for systems
 * handling high-value assets. This script shows how to handle the "Handover"
 * by signing the update with both the old and new keys to prove continuous
 * authority. On Hedera, your Account ID remains stable while your keys change.
 *
 *
 * [ LEARNABLE MOMENT ]
 * On Ethereum, if your private key is leaked, your account address is permanently lost. On Hedera, you can execute an AccountUpdateTransaction to rotate the private key while retaining the exact same Account ID and asset balances.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/native/accounts/update
 *
 * [ LEARNING PATH ]
 * - Previous: M1 Lab 03: Cryptography and Signature Delegation (KMS / HSM)
 * - Next:     M1 Lab 05: Lazy Account Creation (Account Abstraction)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M1_Fundamentals_Functional_JS/04_key_rotation.js
 * ============================================================================
 */

import { AccountId, PrivateKey, AccountUpdateTransaction, AccountInfoQuery } from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Account Key Rotation & Sync ---\n')

  const { client } = getClient()
  const targetId = process.env.ACCOUNT_1_ID
  const targetKey = process.env.ACCOUNT_1_PRIVATE_KEY

  if (!targetId || !targetKey) {
    console.error('[FAILED] Missing required credentials in .env (ACCOUNT_1).')
    process.exitCode = 1
    return
  }

  try {
    const oldPrivateKey = PrivateKey.fromString(targetKey)

    // 2. Generate the NEW replacement key
    console.log(`[PROCESS] Spawning NEW replacement key for Account: ${targetId}...`)
    const newPrivateKey = PrivateKey.generateECDSA()
    const newPublicKey = newPrivateKey.publicKey
    const newKeyStr = newPrivateKey.toStringDer()

    // 3. Prepare and Execute the Update Transaction
    console.log('[PROCESS] Constructing AccountUpdateTransaction...')
    const transaction = await new AccountUpdateTransaction()
      .setAccountId(AccountId.fromString(targetId))
      .setKey(newPublicKey)
      .freezeWith(client)

    // Dual signing required: Old key (authority) + New key (proof of ownership)
    console.log('[INFO] Dual signing required: Authorizing with OLD key + Proving ownership of NEW key...')
    await transaction.sign(oldPrivateKey)
    await transaction.sign(newPrivateKey)

    const response = await transaction.execute(client)
    const receipt = await response.getReceipt(client)

    console.log(`\n[SUCCESS] On-Chain Success! Key Rotation Status: ${receipt.status.toString()}`)

    // 4. Verify on-chain that the account now answers to the new key
    const info = await new AccountInfoQuery().setAccountId(targetId).execute(client)
    if (info.key.toString() !== newPublicKey.toString()) {
      throw new Error('The network still reports the old key after the rotation.')
    }
    console.log(`[SUCCESS] Network confirms the new key: ${newPublicKey.toStringRaw().slice(0, 20)}...`)

    // 5. Rotate back so ACCOUNT_1 keeps matching ACCOUNT_1_PRIVATE_KEY in your .env.
    //    The same dual-signature rule applies: current key (new) + incoming key (old).
    //    In production you would keep the new key and store it in your secrets manager.
    console.log('[PROCESS] Rotating back to the original key so this lab can be re-run...')
    const restoreTx = await new AccountUpdateTransaction()
      .setAccountId(AccountId.fromString(targetId))
      .setKey(oldPrivateKey.publicKey)
      .freezeWith(client)
    await restoreTx.sign(newPrivateKey)
    await restoreTx.sign(oldPrivateKey)
    const restoreReceipt = await (await restoreTx.execute(client)).getReceipt(client)
    console.log(`[SUCCESS] Original key restored: ${restoreReceipt.status.toString()}`)
    console.log(`[LOG] Temporary key used during the demo: ${newKeyStr.slice(0, 45)}...`)

    console.log('\n KEY CONCEPT:')
    console.log('Security Hygiene: Regular key rotation is an industry standard for')
    console.log('systems handling high-value assets. This script shows how to handle')
    console.log('the "Handover" by signing the update with both the old and new keys to')
    console.log('prove continuous authority.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Key Rotation Failed:', error.message)
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
