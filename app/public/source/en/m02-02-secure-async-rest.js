/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: Secure Asynchronous REST Queries
 * [ CONCEPT ] Mirror Node Data Retrieval (Zero Cost)
 * ============================================================================
 * [ KEY CONCEPT ]
 * "Don't pay for what's public." If your application needs to display a
 * balance or a transaction history, your first thought should be Mirror
 * Nodes, not the Consensus network. Mirror Nodes allow for high-throughput
 * reads without transaction fees or cryptographic signatures.
 * *
 * [ LEARNABLE MOMENT ]
 * Always implement defensive HTTP error handling with exponential backoff when querying public Mirror Nodes. Handling rate limits (HTTP 429) gracefully ensures high availability for mission-critical client dashboards.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 *
 * [ LEARNING PATH ]
 * - Previous: M2 Lab 01: Sync Deprecation
 * - Next:     M2 Lab 03: Recursive Pagination
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 02_secure_async_rest.js
 * ============================================================================
 */

import { getClient, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

/**
 * Procedural Mirror Node Fetcher
 */
const getAccountBalancesAsync = async (accountId) => {
  const baseUrl = getMirrorNodeBaseUrl()
  // Build the REST URL: reads go to the Mirror Node, never to consensus nodes.
  const targetUrl = `${baseUrl}/api/v1/balances?account.id=${accountId}`

  console.log(`[⚙️ PROCESS] Interrogating Mirror Node at: ${targetUrl}`)

  try {
    const response = await fetch(targetUrl)

    // Fail loudly on HTTP errors instead of parsing an error page as data.
    if (!response.ok) {
      throw new Error(`Mirror Node Error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (!data.balances || data.balances.length === 0) {
      throw new Error('No bindings found for account')
    }

    // The Mirror Node reports balances in tinybars (1 HBAR = 100,000,000 tinybars).
    const balanceData = data.balances[0]

    return {
      accountId: balanceData.account,
      hbars: balanceData.balance / 100_000_000, // tinybar to hbar conversion
      tokens: balanceData.tokens,
      timestamp: balanceData.timestamp
    }
  } catch (error) {
    throw new Error(`REST Query Failed: ${error.message}`)
  }
}

const main = async () => {
  console.log('--- SESSION START: Secure Async REST (CQRS Pattern) ---\n')

  const { operatorId } = getClient()
  const targetAccount = operatorId

  try {
    console.log(`[ℹ️ INFO] Fetching network state for account: ${targetAccount}...`)
    const balanceData = await getAccountBalancesAsync(targetAccount)

    console.log('\n[✅ SUCCESS] Data successfully fetched from Mirror Node (Zero Cost).')
    console.log(`[📊 LOG] Account ID: ${balanceData.accountId}`)
    console.log(`[📊 LOG] HBAR Balance: ${balanceData.hbars} ℏ`)
    console.log(`[📊 LOG] Token Associations: ${balanceData.tokens.length}`)

    console.log('\n[ℹ️ INFO] Next Step: Handle large datasets with pagination in Lab 03.')

    console.log('\n💡 KEY CONCEPT:')
    console.log("\"Don't pay for what's public.\" If your application needs to display a")
    console.log('balance or a transaction history, your first thought should be Mirror')
    console.log('Nodes, not the Consensus network.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Interrogation Failed:', error.message)
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

export { getAccountBalancesAsync }
