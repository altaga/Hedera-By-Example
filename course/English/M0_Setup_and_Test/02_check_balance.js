/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Manual Account Verification
 * [ CONCEPT ] Network-Stored Identity Discovery
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Client object is your portal. By setting the "Operator," you tell the SDK
 * which account pays the fees for all subsequent queries and transactions.
 * *
 * [ LEARNABLE MOMENT ]
 * Querying consensus nodes directly incurs transaction fees and rate limits. Production dApps should always query Mirror Node REST APIs for read operations: mirror queries are free, highly scalable, and return rich historical state.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/mirror-nodes
 *
 * [ LEARNING PATH ]
 * - Previous: Lab 01: Key Generation
 * - Next:     Lab 03: Unlimited Association
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 02_check_balance.js
 * ============================================================================
 */

import {
  AccountId, PrivateKey,
  MirrorNodeAccountBalanceQuery
} from '@hiero-ledger/sdk'
import { getClient, updateEnv, loadEnv, createClient, waitForMirror, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

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
    console.error('[❌ FAILED] Missing OPERATOR_PRIVATE_KEY in .env.')
    console.error('[ℹ️ INFO] Did you run 01_generate_wallet.js first?')
    process.exit(1)
  }

  // Account ID: the constant above, then OPERATOR_ID from .env, then the account
  // the faucet created for OPERATOR_EVM_ADDRESS (looked up on the Mirror Node).
  const isValidId = (id) => /^\d+\.\d+\.\d+$/.test(id || '')
  let accountId = isValidId(MANUAL_ACCOUNT_ID) ? MANUAL_ACCOUNT_ID : process.env.OPERATOR_ID
  if (!isValidId(accountId) && evmAddress) {
    console.log(`[⚙️ PROCESS] Looking up the account created for ${evmAddress}...`)
    accountId = await waitForMirror(async () => {
      const res = await fetch(`${getMirrorNodeBaseUrl()}/api/v1/accounts/${evmAddress}`)
      return res.ok ? (await res.json()).account : null
    }, { timeoutMs: 10_000 })
  }

  if (!isValidId(accountId)) {
    console.log(`[ℹ️ INFO] Checking Alias Account: ${evmAddress}`)
    console.log(`[📊 LOG] HashScan: https://hashscan.io/testnet/account/${evmAddress}`)
    console.error('\n[❌ FAILED] Error: MANUAL_ACCOUNT_ID is not set and OPERATOR_ID is missing from .env.')
    process.exitCode = 1
    console.error('Paste the 0.0.X ID into the MANUAL_ACCOUNT_ID constant at the top of this file.')
    process.exit(1)
  }

  const client = createClient(accountId, operatorKey)

  try {
    const inputId = accountId
    console.log(`[⚙️ PROCESS] Verifying Account ${inputId} on Hedera Testnet...`)

    const operatorId = AccountId.fromString(inputId)
    client.setOperator(operatorId, PrivateKey.fromString(operatorKey))

    // Verify balance via Mirror Node Query
    console.log('[⚙️ PROCESS] Executing Mirror Node Query for HBAR balance...')
    const query = new MirrorNodeAccountBalanceQuery()
      .setAccountId(operatorId)

    const balance = await query.execute(client)

    console.log('\n[✅ SUCCESS] Network connection confirmed.')
    console.log(`[📊 LOG] Account ID: ${operatorId.toString()}`)
    console.log(`[📊 LOG] Balance:    ${balance.hbars.toString()}`)

    // Update the .env with the verified ID
    console.log('\n[ℹ️ INFO] Synchronizing .env file...')
    updateEnv('OPERATOR_ID', operatorId.toString())

    console.log('[✅ SUCCESS] OPERATOR_ID successfully saved.')
    console.log('Ready for Lab 03.')

    console.log('\n💡 KEY CONCEPT:')
    console.log('The Client object is your portal. By setting the "Operator," you tell')
    console.log('the SDK which account pays the fees for all subsequent queries and')
    console.log('transactions.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Verification Failed:', error.message)
    process.exit(1)
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
