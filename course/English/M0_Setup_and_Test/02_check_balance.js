/**
 * ============================================================================
 * Lab 02: Manual Account Verification
 * [CONCEPT] Network-Stored Identity Discovery
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Client object is your portal. By setting the "Operator," you tell the SDK
 * which account pays the fees for all subsequent queries and transactions.
 * *
 * [ LEARNABLE MOMENT ]
 * This lab reads the balance from the Mirror Node, which is free. Asking a consensus node for the same balance would charge a fee and count against rate limits, so production apps keep reads on the Mirror Node.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/mirror-nodes
 *
 * [ LEARNING PATH ]
 * - Previous: M0 Lab 01: Generate Local Wallet
 * - Next:     M0 Lab 03: Activate Unlimited Auto-Associations
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M0_Setup_and_Test/02_check_balance.js
 * ============================================================================
 */

import {
  MirrorNodeAccountBalanceQuery
} from '@hiero-ledger/sdk'
import { updateEnv, loadEnv, createClient, waitForMirror, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

// Paste the Account ID (0.0.X) you found on HashScan here.
// If left as the placeholder, OPERATOR_ID from .env is used instead.
const MANUAL_ACCOUNT_ID = '0.0.XXXXXX'

const main = async () => {
  console.log('--- SESSION START: Manual Account Verification ---\n')

  // This lab runs before OPERATOR_ID exists, so it cannot use getClient() (which requires it).
  loadEnv()
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY
  const evmAddress = process.env.OPERATOR_EVM_ADDRESS

  if (!operatorKey) {
    console.error('[FAILED] Missing OPERATOR_PRIVATE_KEY in .env. Run Lab 01 first.')
    process.exit(1)
  }

  // Account ID: the constant above, then OPERATOR_ID from .env, then the account
  // the faucet created for OPERATOR_EVM_ADDRESS (looked up on the Mirror Node).
  const isValidId = (id) => /^\d+\.\d+\.\d+$/.test(id || '')
  let accountId = isValidId(MANUAL_ACCOUNT_ID) ? MANUAL_ACCOUNT_ID : process.env.OPERATOR_ID
  if (!isValidId(accountId) && evmAddress) {
    console.log(`[PROCESS] Looking up the account created for ${evmAddress}...`)
    accountId = await waitForMirror(async () => {
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${evmAddress}`)
      return res.ok ? (await res.json()).account : null
    }, { timeoutMs: 10_000 })
  }

  if (!isValidId(accountId)) {
    console.log(`[INFO] Checking Alias Account: ${evmAddress}`)
    console.log(`[LOG] HashScan: https://hashscan.io/testnet/account/${evmAddress}`)
    console.error('\n[FAILED] Error: MANUAL_ACCOUNT_ID is not set and OPERATOR_ID is missing from .env.')
    process.exitCode = 1
    console.error('Paste the 0.0.X ID into the MANUAL_ACCOUNT_ID constant at the top of this file.')
    process.exit(1)
  }

  const client = createClient(accountId, operatorKey)

  try {
    const inputId = accountId
    console.log(`[PROCESS] Verifying Account ${inputId} on Hedera Testnet...`)

    // Verify balance via Mirror Node Query
    const query = new MirrorNodeAccountBalanceQuery()
      .setAccountId(inputId)

    const balance = await query.execute(client)

    console.log('\n[SUCCESS] Network connection confirmed.')
    console.log(`[LOG] Account ID: ${inputId}`)
    console.log(`[LOG] Balance:    ${balance.hbars.toString()}`)

    // Remember the verified ID for the labs that follow (.env in Node, browser state here).
    const inBrowser = typeof window !== 'undefined'
    console.log(inBrowser
      ? '\n[INFO] Saving OPERATOR_ID for the labs that follow (this browser does not write a .env file)...'
      : '\n[INFO] Synchronizing .env file...')
    updateEnv('OPERATOR_ID', inputId)

    console.log(inBrowser ? '[SUCCESS] OPERATOR_ID saved for the next labs.' : '[SUCCESS] OPERATOR_ID successfully saved.')
    console.log('Ready for Lab 03.')

    console.log('\n KEY CONCEPT:')
    console.log('The Client object is your portal. By setting the "Operator," you tell')
    console.log('the SDK which account pays the fees for all subsequent queries and')
    console.log('transactions.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Verification Failed:', error.message)
    process.exit(1)
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
