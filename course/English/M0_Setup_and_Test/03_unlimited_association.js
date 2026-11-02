/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Activate Unlimited Auto-Associations
 * [ CONCEPT ] Frictionless Token Reception
 * ============================================================================
 * [ KEY CONCEPT ]
 * The value `-1` in `setMaxAutomaticTokenAssociations` is the magic number
 * for "Unlimited". This simplifies UX for your future dApp users by removing
 * the need for manual association transactions.
 * *
 * [ LEARNABLE MOMENT ]
 * Setting max_automatic_token_associations to -1 on your developer wallet prevents transaction reverts during airdrops, DEX swaps, and multi-asset payouts by allowing the network to auto-associate incoming tokens on the fly.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-23
 *
 * [ LEARNING PATH ]
 * - Previous: Lab 02: Account Verification
 * - Next:     Lab 04: Environment Provisioning
 *
 * [ HOW TO RUN ]
 * node 03_unlimited_association.js
 * ============================================================================
 */

import {
  AccountId,
  AccountUpdateTransaction
} from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Account Optimization ---\n')

  const { client, operatorId } = getClient()
  const opId = AccountId.fromString(operatorId)

  try {
    // 3. Prepare the Update Transaction
    console.log('[⚙️ PROCESS] Constructing AccountUpdateTransaction...')
    console.log('[ℹ️ INFO] Setting MaxAutomaticTokenAssociations to -1 (Unlimited)...')

    const transaction = await new AccountUpdateTransaction()
      .setAccountId(opId)
      .setMaxAutomaticTokenAssociations(-1)
      .freezeWith(client)

    // 4. Sign and Execute
    console.log('[⚙️ PROCESS] Signing with Operator Key and executing transaction...')
    const response = await transaction.execute(client)

    console.log('[ℹ️ INFO] Waiting for network consensus receipt...')
    const receipt = await response.getReceipt(client)

    console.log('\n[✅ SUCCESS] Unlimited Auto-Associations Active.')
    console.log(`[📊 LOG] Receipt Status: ${receipt.status.toString()}`)
    console.log('\n[ℹ️ INFO] Wallet can now receive any token (FT or NFT) automatically.')
    console.log('Ready for Lab 04.')

    console.log('\n💡 KEY CONCEPT:')
    console.log('The value `-1` in `setMaxAutomaticTokenAssociations` is the magic')
    console.log('number for "Unlimited". This simplifies UX for your future dApp users.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Operation Failed:', error.message)
    process.exitCode = 1
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
