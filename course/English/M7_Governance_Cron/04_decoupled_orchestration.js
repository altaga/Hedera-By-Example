/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Decoupled Orchestration and Quorum
 * [CONCEPT] Signature Fragment Collection
 * ============================================================================
 * [ KEY CONCEPT ]
 * Trustless Orchestration: The "Orchestrator" doesn't need to hold any keys.
 * They simply tell the required signers the `ScheduleId`, and the signers
 * send their approval directly to the ledger. This script uses
 * `ScheduleSignTransaction` to provide the missing signature fragment.
 * The millisecond the network receives enough signatures, the inner
 * transaction is executed automatically by the Hedera protocol.
 * *
 * [ LEARNABLE MOMENT ]
 * Decoupled scheduling allows one entity to create and pay for a transaction, while authorizing signers submit their signatures independently over time until the execution quorum is reached.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/native/scheduled/sign
 *
 * [ LEARNING PATH ]
 * - Previous: M7 Lab 03: Native Cron
 * - Next:     M7 Lab 05: Decentralized Identity
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Run first: M7 Lab 03 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 04_decoupled_orchestration.js
 * ============================================================================
 */

import { PrivateKey, ScheduleSignTransaction } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Decoupled Quorum Collection ---\n')

  const { client } = getClient()
  const userKey = process.env.ACCOUNT_1_PRIVATE_KEY
  const scheduleId = getState('SCHEDULE_ID')

  if (!userKey || !scheduleId) {
    console.error('[FAILED] Missing ACCOUNT_1_PRIVATE_KEY or SCHEDULE_ID in configuration.')
    process.exitCode = 1
    console.log('[INFO] Tip: Run Lab 03 first to schedule a transaction.')
    return
  }

  try {
    console.log(`[PROCESS] Adding signature fragment to Schedule: ${scheduleId}...`)

    // Use ScheduleSignTransaction to add the child wallet's signature
    const transaction = await new ScheduleSignTransaction()
      .setScheduleId(scheduleId)
      .freezeWith(client)

    // Sign with the Child Wallet (the required signer for the inner transfer)
    console.log('[INFO] Signing with decentralized authority (Child Wallet)...')
    const signedTx = await transaction.sign(PrivateKey.fromString(userKey))

    const response = await signedTx.execute(client)

    console.log(`[LOG] View on HashScan: ${getHashscanUrl(response)}`)

    const receipt = await response.getReceipt(client)

    console.log(`\n[SUCCESS] Signature Collected! Status: ${receipt.status.toString()}`)
    console.log('[INFO] If threshold met, the inner transaction has been triggered.')

    console.log('\n KEY CONCEPT:')
    console.log("Trustless Orchestration: The \"Orchestrator\" doesn't need to hold any")
    console.log('keys. They simply tell the required signers the `ScheduleId`, and the')
    console.log('signers send their approval directly to the ledger. Hedera acts as the')
    console.log('secure, impartial judge of the quorum.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Signature Orchestration Failed:', error.message)
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
