/**
 * ============================================================================
 * Lab 03: Native Cron Services (On-chain Scheduling)
 * [CONCEPT] Asynchronous Transaction "Waiting Rooms"
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Decoupled Workflow: This is how corporate payroll or treasury management
 * works. One person proposes the payout, and the board members sign it
 * whenever they log in later that day. Scheduling on Hedera acts like an
 * on-chain "Waiting Room". Once the required signatures are collected,
 * the transaction executes automatically. No smart contract logic is needed
 * to managed the state of the vote.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Hedera Schedule Service (HSS) acts as a native on-chain cron daemon: transactions can be scheduled to execute automatically at an exact future consensus timestamp without centralized server crons.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/schedule-transaction
 *
 * [ LEARNING PATH ]
 * - Previous: M7 Lab 02: Multisig Transfer
 * - Next:     M7 Lab 04: Decoupled Orchestration
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 03_native_cron.js
 * ============================================================================
 */

import {
  AccountId,
  ScheduleCreateTransaction, TransferTransaction, Hbar, Timestamp
} from '@hiero-ledger/sdk'
import { getClient, updateState, getHashscanUrl } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Native Cron / Scheduling ---\n')

  const { client, operatorId } = getClient()
  const targetId = process.env.ACCOUNT_1_ID

  if (!targetId) {
    console.error('[FAILED] Missing ACCOUNT_1_ID in configuration.')
    process.exitCode = 1
    return
  }

  try {
    console.log('[PROCESS] Proposing a Scheduled Transfer of 0.1 HBAR from Child Wallet...')

    // 1. Define the INNER transaction (Child -> Operator)
    const innerTx = new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(targetId), new Hbar(-0.1))
      .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(0.1))

    // 2. Wrap it inside the OUTER Scheduled transaction
    const expiration = new Date()
    expiration.setMinutes(expiration.getMinutes() + 15)

    const scheduleTx = await new ScheduleCreateTransaction()
      .setScheduledTransaction(innerTx)
      .setPayerAccountId(AccountId.fromString(operatorId))
      .setScheduleMemo('Module 7.3 Lab Schedule')
      .setExpirationTime(Timestamp.fromDate(expiration))
      .setWaitForExpiry(false) // Execute as soon as signatures are met
      .freezeWith(client)

    const response = await scheduleTx.execute(client)

    console.log(`[LOG] View on HashScan: ${getHashscanUrl(response)}`)

    const receipt = await response.getReceipt(client)
    const scheduleId = receipt.scheduleId.toString()

    console.log(`\n[SUCCESS] Transaction Scheduled: ${scheduleId}`)
    console.log('[INFO] The proposal is now pending on the ledger (15min window).')

    // Sync for subsequent step
    console.log('[INFO] Synchronizing state.json with Schedule ID...')
    updateState('SCHEDULE_ID', scheduleId)

    console.log('\n KEY CONCEPT:')
    console.log('The Decoupled Workflow: This is how corporate payroll or treasury')
    console.log('management works. One person proposes the payout, and the board')
    console.log('members sign it whenever they log in later that day. No smart contract')
    console.log('logic is needed to manage the state of the vote.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Scheduling Prototyping Failed:', error.message)
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
