/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: State Rent & Account Lifecycle
 * [CONCEPT] Sustainability and Serverless Storage
 * ============================================================================
 * [ KEY CONCEPT ]
 * This is effectively "Serverless Cloud Storage" for your identity. If you
 * fund an account with just a few HBAR, it can remain active for decades.
 * Dedicated rent ensures the network stays slim, fast, and secure by
 * preventing "State Bloat".
 * *
 * [ LEARNABLE MOMENT ]
 * State storage on public ledgers is not free. Setting an explicit auto-renew period and designating an auto-renew account prevents smart contracts or entity state from expiring unexpectedly.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/accounts/account-properties
 *
 * [ LEARNING PATH ]
 * - Previous: M1 Lab 01: Consensus & aBFT
 * - Next:     M1 Lab 03: Cryptography & KMS
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 02_account_rent.js
 * ============================================================================
 */

import {
  MirrorNodeAccountBalanceQuery, AccountId
} from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Rent Lifecycle Projection ---\n')

  const { client } = getClient()
  const targetAccountId = process.env.ACCOUNT_1_ID

  if (!targetAccountId) {
    console.error('[FAILED] Missing ACCOUNT_1_ID in .env.')
    process.exitCode = 1
    return
  }

  try {
    // --- STAGE 1: MARKET TELEMETRY (Mirror Node Oracle) ---
    console.log('[PROCESS] Fetching consensus exchange rate from Mirror Node...')

    const mirrorUrl = getMirrorNodeBaseUrl()
    const response = await fetch(`${mirrorUrl}/api/v1/network/exchangerate`)
    const rateData = await response.json()

    const currentRate = rateData.current_rate
    const liveHbarPrice = (currentRate.cent_equivalent / currentRate.hbar_equivalent) / 100

    console.log(`[LOG] Live Rate: 1 HBAR = $${liveHbarPrice.toFixed(4)} USD\n`)

    // --- STAGE 2: BALANCE TELEMETRY ---
    console.log(`[PROCESS] Querying balance for Account: ${targetAccountId}...`)
    const query = new MirrorNodeAccountBalanceQuery().setAccountId(AccountId.fromString(targetAccountId))
    const balance = await query.execute(client)

    const currentHbar = Number(balance.hbars.toTinybars()) / 100000000
    console.log(`[LOG] Current Balance: ${balance.hbars.toString()} (${currentHbar} HBAR)`)

    // --- STAGE 3: MATH (The Rent Projection) ---
    const renewalFeeUsd = 0.01 // Hedera standard periodic rent

    const totalUsdValue = currentHbar * liveHbarPrice
    const totalCycles = totalUsdValue / renewalFeeUsd
    const totalDaysCovered = totalCycles * 90
    const totalYearsCovered = (totalDaysCovered / 365).toFixed(1)

    console.log('\n---  Rent Runway Projection ---')
    console.log(`└─ Total USD Value:   $${totalUsdValue.toFixed(4)} USD`)
    console.log(`└─ Renewal Cycles:    ${Math.floor(totalCycles)} periods (90 days each)`)
    console.log(`└─ Total Lifespan:    ~${totalYearsCovered} Years`)

    console.log('\n KEY CONCEPT:')
    console.log('As long as this account holds HBAR, it will automatically pay')
    console.log('its own rent every 90 days. If the balance hits 0, the node')
    console.log('will eventually delete the account to free up memory.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Query Failed:', error.message)
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
