/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Multi-signature Models and KeyLists
 * [ CONCEPT ] Native Threshold Authority
 * ============================================================================
 * [ KEY CONCEPT ]
 * Governance without Gas: In traditional systems, you need a smart contract
 * for complex multisig logic. Hedera handles `KeyList` objects natively.
 * Because this is enforced by consensus nodes during signature verification,
 * there is zero smart contract risk and no extra gas cost. It is pure
 * cryptographic policy enforced at the ledger core.
 * *
 * [ LEARNABLE MOMENT ]
 * Multi-signature KeyLists on Hedera operate natively at the consensus layer without smart contracts: configuring M-of-N signature thresholds prevents single-point-of-failure treasury compromise.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/keys-and-signatures#key-lists
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 10: Zero-Trust Encrypted Vault
 * - Next:     M7 Lab 02: Multisig Transfer
 *
 * [ HOW TO RUN ]
 * node 01_multisig_keylist.js
 * ============================================================================
 */

import { PrivateKey, KeyList, AccountCreateTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, updateState, getHashscanUrl } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Multisig KeyList Deployment ---\n')

  const { client } = getClient()

  try {
    console.log('[ℹ️ INFO] Generating 3 independent Ed25519 identities...')
    const aliceKey = PrivateKey.generateED25519()
    const bobKey = PrivateKey.generateED25519()
    const charlieKey = PrivateKey.generateED25519()

    // 1. Create the native Hedera KeyList with a threshold
    const thresholdList = new KeyList()
    thresholdList.push(aliceKey.publicKey)
    thresholdList.push(bobKey.publicKey)
    thresholdList.push(charlieKey.publicKey)
    thresholdList.setThreshold(2) // REQUIRED: 2 signatures to approve any transaction from this account.

    console.log('[✅ SUCCESS] Threshold Key Constructed: 2-of-3 signatures required.')
    console.log(`[📊 LOG] KeyList Fingerprint: ${thresholdList.toString().slice(0, 32)}...`)

    // 2. Deploy the Account to Testnet with this KeyList
    console.log('\n[⚙️ PROCESS] Deploying Multisig Account to the ledger...')
    const transaction = await new AccountCreateTransaction()
      .setKeyWithoutAlias(thresholdList)
      .setInitialBalance(new Hbar(0.5)) // Funding the multisig account
      .execute(client)

    const receipt = await transaction.getReceipt(client)
    const multisigAccountId = receipt.accountId.toString()

    console.log(`\n[✅ SUCCESS] Multisig Account Created: ${multisigAccountId}`)
    console.log(`[📊 LOG] View on HashScan: ${getHashscanUrl(transaction)}`)

    // 3. Persist data for subsequent tests
    console.log('[ℹ️ INFO] Synchronizing state.json with multisig credentials...')
    updateState('MULTISIG_ACCOUNT_ID', multisigAccountId)
    updateState('MULTISIG_KEY_ALICE', aliceKey.toString())
    updateState('MULTISIG_KEY_BOB', bobKey.toString())
    updateState('MULTISIG_KEY_CHARLIE', charlieKey.toString())

    console.log('\n💡 KEY CONCEPT:')
    console.log('Governance without Gas: Because this is handled by the consensus nodes')
    console.log('during the signature verification phase, there is no code to audit and')
    console.log('no smart contract execution risk. It is pure cryptographic policy.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Multisig Deployment Failed:', error.message)
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
