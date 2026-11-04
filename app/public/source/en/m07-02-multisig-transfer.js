/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Testing the Multisig Authority
 * [CONCEPT] Cryptographically Enforced Permission Layer
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Enforcement Layer: Traditional databases rely on application code to
 * check permissions. In Hedera, the "Database" (the Ledger) refuses to
 * even process the transaction if the cryptographic threshold isn't met.
 * The permission logic is part of the data itself. We will prove this by
 * attempting a transfer with 1 signature (Fail) and 2 signatures (Success).
 * *
 * [ LEARNABLE MOMENT ]
 * Executing a multi-sig transfer requires collecting required signatures before submission or leveraging Scheduled Transactions to allow signing parties to approve asynchronously from separate geographical locations.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/schedule-transaction
 *
 * [ LEARNING PATH ]
 * - Previous: M7 Lab 01: Multisig KeyList
 * - Next:     M7 Lab 03: Native Cron
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M7 Lab 01 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 02_multisig_transfer.js
 * ============================================================================
 */

import {
  TransferTransaction, Hbar, PrivateKey, AccountId
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Multisig Authority Verification ---\n')

  const { client, operatorId } = getClient()

  // Load multisig context from shared state
  const multisigId = getState('MULTISIG_ACCOUNT_ID')
  const aliceKeyStr = getState('MULTISIG_KEY_ALICE')
  const bobKeyStr = getState('MULTISIG_KEY_BOB')

  if (!multisigId || !aliceKeyStr || !bobKeyStr) {
    console.error('[FAILED] Multisig Account ID not found. Run Lab 01 first.')
    process.exitCode = 1
    return
  }

  const aliceKey = PrivateKey.fromString(aliceKeyStr)
  const bobKey = PrivateKey.fromString(bobKeyStr)

  console.log(`[INFO] Testing Threshold Policy for Account: ${multisigId}`)

  try {
    // --- PHASE 1: ATTEMPT WITH 1 SIGNATURE (ALICE ONLY) ---
    console.log('\n--- Phase 1: Under-Threshold Simulation ---')
    console.log('[PROCESS] Proposing transfer with only 1 signature (Alice)...')

    const failTx = await new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(multisigId), new Hbar(-0.1))
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(0.1))
      .freezeWith(client)
      .sign(aliceKey)

    try {
      const response = await failTx.execute(client)
      await response.getReceipt(client)
      console.log('[FAILED] Logic Violation: Transaction succeeded without enough signatures!')
    } catch (e) {
      console.log('[SUCCESS] Expected Failure: Network rejected (INVALID_SIGNATURE).')
      console.log(`[LOG] Network error message: ${e.message}`)
    }

    // --- PHASE 2: ATTEMPT WITH 2 SIGNATURES (ALICE + BOB) ---
    console.log('\n--- Phase 2: Threshold Compliance Simulation ---')
    console.log('[PROCESS] Proposing transfer with 2 required signatures (Alice + Bob)...')

    const successTx = await new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(multisigId), new Hbar(-0.1))
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(0.1))
      .freezeWith(client)
      .sign(aliceKey)

    // Adding the second signature fragment
    await successTx.sign(bobKey)

    const response = await successTx.execute(client)
    const receipt = await response.getReceipt(client)

    console.log(`\n[SUCCESS] TRANSACTION SUCCESSFUL! Status: ${receipt.status.toString()}`)
    console.log(`[LOG] View on HashScan: ${getHashscanUrl(response)}`)

    console.log('\n KEY CONCEPT:')
    console.log('The Enforcement Layer: In Hedera, the "Database" (the Ledger)')
    console.log('refuses to even process the transaction if the cryptographic')
    console.log('threshold isn\'t met. The permission logic is part of the data itself.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Unexpected Authority Failure:', error.message)
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
