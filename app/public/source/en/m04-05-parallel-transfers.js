/**
 * ============================================================================
 * Lab 05: High-Throughput Parallel Benchmarking
 * [CONCEPT] Horizontal Core Scalability
 * ============================================================================
 * [ KEY CONCEPT ]
 * Horizontal Scalability: On a traditional blockchain, more transactions
 * usually mean more congestion. On Hedera, the "Gossip about Gossip" protocol
 * allows nodes to process thousands of transactions in parallel without linear
 * slowdowns. Executing 20 transactions in parallel is NOT 20x slower than 1.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Submitting high-frequency parallel transactions from a single operator requires distinct validStart timestamps. Staggering nanoseconds prevents transaction duplicate detection from dropping rapid-fire payouts.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/native/transactions/submit
 *
 * [ LEARNING PATH ]
 * - Previous: M4 Lab 04: Atomic Swaps (Multi-Asset Exchange)
 * - Next:     M4 Lab 06: Native Airdrops (HIP-904)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M4_Token_Operations_Atomic_Swaps/05_parallel_transfers.js
 * ============================================================================
 */

import { AccountId, Hbar, TransferTransaction } from '@hiero-ledger/sdk'
import { getClient, show } from '../M99_Utilities/index.js'

/**
 * Executes a batch of HBAR transfers in parallel and measures the duration.
 */
const runParallelBatch = async (client, operatorId, targetId, batchSize) => {
  console.log(`\n[INFO] Starting Batch: ${batchSize} Parallel Transactions...`)

  const tasks = []
  const amount = 0.01 // Small amount for benchmarking

  const startTime = Date.now()

  for (let i = 0; i < batchSize; i++) {
    tasks.push((async () => {
      const transaction = await new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(operatorId), new Hbar(-amount))
        .addHbarTransfer(AccountId.fromString(targetId), new Hbar(amount))
        .freezeWith(client)

      const response = await transaction.execute(client)
      return response.getReceipt(client)
    })())
  }

  // Wait for all consensus receipts in parallel
  console.log(`[PROCESS] Dispatching ${batchSize} transactions simultaneously...`)
  await Promise.all(tasks)
  const endTime = Date.now()
  const duration = endTime - startTime

  console.log(`[SUCCESS] Batch ${batchSize} complete in ${duration}ms`)
  return {
    batchSize,
    totalTime: duration,
    avgTimePerTx: Math.round(duration / batchSize)
  }
}

const main = async () => {
  console.log('--- SESSION START: High-Throughput Performance Benchmark ---\n')

  const { client, operatorId } = getClient()
  const targetId = process.env.ACCOUNT_1_ID

  if (!targetId) {
    console.error('[FAILED] Missing ACCOUNT_1_ID in .env.')
    process.exitCode = 1
    return
  }

  try {
    const benchmarkResults = []

    // Run comparisons: 1, 5, 10, 20
    const batchSizes = [1, 5, 10, 20]

    for (const size of batchSizes) {
      const result = await runParallelBatch(client, operatorId, targetId, size)
      benchmarkResults.push(result)
      show.chart({ id: 'parallel', type: 'bar', title: 'Average time per transaction by batch size', unit: 'ms', xLabel: 'Batch', yLabel: 'ms / tx', items: benchmarkResults.map((r) => ({ label: `${r.batchSize} tx`, value: Number(r.avgTimePerTx) })) })
      // Brief sleep between batches to let the network settle
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    // --- FINAL PERFORMANCE REPORT ---
    console.log('\n' + '='.repeat(60))
    console.log('HTS PERFORMANCE BENCHMARK SUMMARY')
    console.log('='.repeat(60))
    console.log('Batch Size | Total Time (ms) | Avg Time/Tx (ms)')
    console.log('-'.repeat(60))

    benchmarkResults.forEach(res => {
      const sizeStr = res.batchSize.toString().padEnd(11)
      const totalStr = res.totalTime.toString().padEnd(16)
      const avgStr = res.avgTimePerTx.toString()
      console.log(`${sizeStr}| ${totalStr}| ${avgStr}`)
    })
    console.log('='.repeat(60))
    console.log('[INFO] Observation: compare Avg Time/Tx across the batch sizes above (one client, testnet).')
    console.log('='.repeat(60))

    console.log('\n KEY CONCEPT:')
    console.log('Horizontal Scalability: On a traditional blockchain, more transactions')
    console.log('usually mean more congestion. On Hedera, the "Gossip about Gossip"')
    console.log('protocol allows the network to handle thousands of transactions in')
    console.log('parallel without linear slowdowns.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Benchmark Failed:', error.message)
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
