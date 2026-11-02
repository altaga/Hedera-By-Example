/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Deprecation of Synchronous State Queries
 * [ CONCEPT ] Consensus Node Mutation vs. Mirror Node Query
 * ============================================================================
 * [ KEY CONCEPT ]
 * The "Legacy" Query: Starting in @hiero-ledger/sdk v2.90+, `AccountBalanceQuery`
 * against consensus nodes is officially disabled and throws a deprecation error,
 * enforcing the migration to `MirrorNodeAccountBalanceQuery` or Mirror Node REST APIs.
 * This is part of the Command Query Responsibility Segregation (CQRS) shift.
 * *
 * [ LEARNABLE MOMENT ]
 * Do not use synchronous consensus node queries for reading state in production. Adopting the Command Query Responsibility Segregation (CQRS) pattern decouples write transactions on consensus from free, low-latency reads on Mirror Nodes.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/mirror-nodes
 *
 * [ LEARNING PATH ]
 * - Previous: M1 Lab 04: Key Rotation
 * - Next:     M2 Lab 02: Secure Async REST
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 01_sync_deprecation.js
 * ============================================================================
 */

import { AccountBalanceQuery, MirrorNodeAccountBalanceQuery, AccountId } from '@hiero-ledger/sdk'
import { getClient } from '../M99_Utilities/index.js'

/**
 * LEGACY PATTERN vs CQRS REPLACEMENT:
 * Demonstrates the SDK enforcement of Mirror Node queries over Consensus queries.
 */
const legacyBalanceQuery = async (client, accountIdStr) => {
  console.warn('\n⚠️ [WARNING]: Attempting legacy AccountBalanceQuery on Consensus nodes...')
  console.log('[ℹ️ INFO] In @hiero-ledger/sdk v2.90+, this pattern is blocked in favor of Mirror Node CQRS.')

  try {
    const query = new AccountBalanceQuery()
      .setAccountId(AccountId.fromString(accountIdStr))
    const balance = await query.execute(client)
    return balance.hbars
  } catch (deprecatedError) {
    console.log(`[✅ CQRS ENFORCED] SDK blocked legacy consensus query: "${deprecatedError.message}"`)
    console.log('[⚙️ PROCESS] Falling back to MirrorNodeAccountBalanceQuery...')
    const mirrorBalance = await new MirrorNodeAccountBalanceQuery()
      .setAccountId(AccountId.fromString(accountIdStr))
      .execute(client)
    return mirrorBalance.hbars
  }
}

const main = async () => {
  console.log('--- SESSION START: Legacy Query Deprecation ---\n')

  const { client, operatorId } = getClient()

  try {
    console.log(`[⚙️ PROCESS] Interrogating state for account: ${operatorId}...`)
    const hbars = await legacyBalanceQuery(client, operatorId)

    console.log(`[📊 LOG] Retrieved Balance: ${hbars.toString()}`)
    console.log('\n[ℹ️ INFO] Ready for the CQRS Mirror Node Fetch structure in Lab 02.')

    console.log('\n💡 KEY CONCEPT:')
    console.log('The "Legacy" Query: Consensus nodes are for ordering transactions (Commands),')
    console.log('not serving state reads (Queries). Using Mirror Nodes fetches data for free')
    console.log('and preserves consensus CPU for high-throughput transactions.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Query Failed:', error.message)
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

export { legacyBalanceQuery }
