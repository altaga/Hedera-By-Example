/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Data Transformation and Pagination
 * [CONCEPT] Cursor-based Recursive Fetching
 * ============================================================================
 * [ KEY CONCEPT ]
 * "Don't overwhelm the thread."By processing data in pages, you keep your
 * application memory-efficient and responsive, even when performing complex
 * analysis on thousands of historical transaction records. Fetching in small,
 * manageable chunks is the standard for production Mirror Node integration.
 * *
 * [ LEARNABLE MOMENT ]
 * Never assume query results fit in a single response page. Production indexers and auditors must recursively follow the links.next cursor until null to guarantee that zero historical records or token holders are dropped.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/rest-api#pagination
 *
 * [ LEARNING PATH ]
 * - Previous: M2 Lab 02: Secure Async REST
 * - Next:     M2 Lab 04: Real-Time Event Sourcing Reactor (SQLite CQRS)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 03_recursive_pagination.js
 * ============================================================================
 */

import { getClient, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

/**
 * Procedural Paginated Fetcher
 */
const getCompleteAccountHistory = async (accountId) => {
  const baseUrl = getMirrorNodeBaseUrl()
  let nextPath = `/api/v1/transactions?account.id=${accountId}&limit=10` // Limit to 10 for demonstration
  let allTransactions = []

  console.log(`[PROCESS] Interrogating Transaction History for Account: ${accountId}`)

  while (nextPath) {
    const targetUrl = nextPath.startsWith('http') ? nextPath : `${baseUrl}${nextPath}`
    console.log(`[INFO] Pagination: Fetching next page: ${targetUrl.substring(0, 70)}...`)

    const response = await fetch(targetUrl)
    if (!response.ok) {
      throw new Error(`Mirror Node Error: ${response.status}`)
    }

    const data = await response.json()

    if (data.transactions) {
      allTransactions = [...allTransactions, ...data.transactions]
    }

    // Logic check for next page
    nextPath = (data.links && data.links.next) ? data.links.next : null

    // Safety break for classroom: limit to 3 pages max
    if (allTransactions.length > 30) break
  }

  return allTransactions
}

const main = async () => {
  console.log('--- SESSION START: Data Transformation & Pagination ---\n')

  const { operatorId } = getClient()
  const targetAccount = operatorId

  try {
    console.log('[INFO] Beginning recursive crawl of account history...')
    const history = await getCompleteAccountHistory(targetAccount)

    console.log('\n[SUCCESS] Pagination Complete.')
    console.log(`[LOG] Total Transactions Retrieved: ${history.length}`)

    if (history.length > 0) {
      // Data Analysis using standard JS array methods
      console.log('[PROCESS] Performing local data analysis on result set...')
      const successfulTxs = history.filter(tx => tx.result === 'SUCCESS')
      const totalFeesPaid = successfulTxs.reduce((sum, tx) => sum + parseInt(tx.charged_tx_fee), 0)
      const latestTimestamp = successfulTxs[0]?.consensus_timestamp

      console.log(`└─ Successful Transactions: ${successfulTxs.length}`)
      console.log(`└─ Total Fees Paid:         ${totalFeesPaid} tinybars (${totalFeesPaid / 100000000} HBAR)`)
      console.log(`└─ Most Recent Event:      ${latestTimestamp}`)
    } else {
      console.log('[INFO] No transaction history found for this account.')
    }

    console.log('\n KEY CONCEPT:')
    console.log("\"Don't overwhelm the thread.\"By processing data in pages, you keep")
    console.log('your application memory-efficient and responsive, even when performing')
    console.log('complex analysis on historical data.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Recursive Fetch Failed:', error.message)
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

export { getCompleteAccountHistory }
