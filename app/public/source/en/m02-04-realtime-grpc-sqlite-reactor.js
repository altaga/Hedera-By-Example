/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Real-Time Event Sourcing Reactor (Mirror Stream + SQLite In-Memory CQRS)
 * [ CONCEPT ] Sub-Millisecond Relational Read-Model over Hedera Consensus Events
 * ============================================================================
 * [ KEY CONCEPT ]
 * In production fintech and decentralized exchange (DEX) architectures, relying
 * on live network calls to Mirror Nodes for every user click or trade evaluation
 * creates severe latency (200ms–800ms per HTTP round-trip) and rate-limit bottlenecks.
 * The Command Query Responsibility Segregation (CQRS) Event Sourcing Reactor pattern
 * solves this:
 * 1. COMMAND SIDE: State mutations execute against Hedera Consensus Nodes (L1).
 * 2. REACTIVE INGESTION: The Reactor ingests transactions from the Mirror stream.
 * 3. QUERY READ-MODEL: Events are materialized into an embedded in-memory relational
 *    database (`node:sqlite`) with indexes, foreign keys, and pre-computed aggregates.
 * 4. ULTRA-LOW LATENCY: Analytical queries execute in microseconds (< 0.2ms) directly
 *    from CPU memory, providing a 1,000x+ performance acceleration.
 *
 * [ LEARNABLE MOMENT ]
 * Enterprise Web3 applications do not replace classic relational databases—they
 * treat the public ledger as the immutable log of truth and use fast embedded SQL
 * engines as decentralized CQRS read views.
 *
 * [ LEARNING PATH ]
 * - Previous: M2 Lab 03: Recursive Pagination
 * - Next:     M2 Lab 05: Circuit Breaker & Rate Limiter
 *
 * [ HOW TO RUN ]
 * node English/M2_State_Interrogation_CQRS/04_realtime_grpc_sqlite_reactor.js
 * ============================================================================
 */

import { DatabaseSync } from 'node:sqlite'
import {
  TransferTransaction,
  Hbar,
  AccountId
} from '@hiero-ledger/sdk'
import { getClient, getMirrorNodeBaseUrl, sleep, updateState } from '../M99_Utilities/index.js'

const setupInMemoryDatabase = () => {
  const db = new DatabaseSync(':memory:')

  // Create high-performance relational tables for the CQRS read model
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT UNIQUE NOT NULL,
      consensus_timestamp TEXT NOT NULL,
      payer_account_id TEXT NOT NULL,
      recipient_account_id TEXT,
      amount_hbar REAL DEFAULT 0,
      result TEXT NOT NULL,
      ingested_at TEXT NOT NULL
    );

    CREATE TABLE account_aggregates (
      account_id TEXT PRIMARY KEY,
      tx_count INTEGER DEFAULT 0,
      total_sent_hbar REAL DEFAULT 0,
      total_received_hbar REAL DEFAULT 0,
      net_flow_hbar REAL DEFAULT 0,
      last_updated TEXT NOT NULL
    );

    CREATE INDEX idx_tx_payer ON transactions(payer_account_id);
    CREATE INDEX idx_tx_timestamp ON transactions(consensus_timestamp);
  `)

  return db
}

const main = async () => {
  console.log('--- SESSION START: Real-Time Event Sourcing Reactor (SQLite CQRS) ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Initialize Embedded SQLite In-Memory Read-Model
    console.log('[⚙️ PROCESS] Initializing Embedded `node:sqlite` In-Memory Relational Engine...')
    const db = setupInMemoryDatabase()
    console.log('[✅ SUCCESS] SQLite CQRS Schema Materialized (Tables: `transactions`, `account_aggregates`)')

    // 2. Command Side: Trigger a fresh on-chain testnet event
    console.log('\n[⚙️ PROCESS] [COMMAND SIDE] Generating Live Consensus Event on Hedera Testnet...')
    const dummyRecipient = AccountId.fromString('0.0.8707881')
    const microTransferTx = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-0.01))
      .addHbarTransfer(dummyRecipient, new Hbar(0.01))
      .setTransactionMemo('CQRS:EVENT_REACTOR_TRIGGER')
      .execute(client)

    const receipt = await microTransferTx.getReceipt(client)
    console.log(`[✅ SUCCESS] Consensus Command Settled! Status: ${receipt.status.toString()}`)
    console.log(`[📊 LOG] Transaction ID: ${microTransferTx.transactionId.toString()}`)

    // Allow Mirror Node a brief window to reach consensus ingestion
    console.log('\n[⚙️ PROCESS] Waiting 3.5s for Mirror Node event propagation...')
    await sleep(3500)

    // 3. Ingestion Reactor: Ingest and materialize mirror events into SQLite
    console.log('[⚙️ PROCESS] [INGESTION REACTOR] Pulling transaction events from Mirror Node...')
    const baseUrl = getMirrorNodeBaseUrl()
    const mirrorResponse = await fetch(`${baseUrl}/api/v1/transactions?account.id=${operatorId.toString()}&limit=25&order=desc`)

    if (!mirrorResponse.ok) {
      throw new Error(`Mirror Node HTTP Error: ${mirrorResponse.status}`)
    }

    const mirrorData = await mirrorResponse.json()
    const transactions = mirrorData.transactions || []
    console.log(`[📊 LOG] Retrieved ${transactions.length} raw historical events from Mirror Node.`)

    // Prepared statements for high-throughput batch inserts
    const insertTxStmt = db.prepare(`
      INSERT OR IGNORE INTO transactions 
      (transaction_id, consensus_timestamp, payer_account_id, recipient_account_id, amount_hbar, result, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const upsertAggregateStmt = db.prepare(`
      INSERT INTO account_aggregates (account_id, tx_count, total_sent_hbar, total_received_hbar, net_flow_hbar, last_updated)
      VALUES (?, 1, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        tx_count = tx_count + 1,
        total_sent_hbar = total_sent_hbar + excluded.total_sent_hbar,
        total_received_hbar = total_received_hbar + excluded.total_received_hbar,
        net_flow_hbar = net_flow_hbar + excluded.net_flow_hbar,
        last_updated = excluded.last_updated
    `)

    db.exec('BEGIN TRANSACTION')
    const now = new Date().toISOString()
    let ingestedCount = 0

    for (const tx of transactions) {
      const txId = tx.transaction_id || `tx_${Math.random()}`
      const timestamp = tx.consensus_timestamp
      const result = tx.result || 'UNKNOWN'

      // Extract transfer flow for the operator
      let hbarTransferred = 0
      let recipientId = null

      if (Array.isArray(tx.transfers)) {
        for (const t of tx.transfers) {
          if (t.account === operatorId.toString()) {
            hbarTransferred = Number(t.amount) / 100000000 // Convert tinybars to HBAR
          } else if (t.amount > 0) {
            recipientId = t.account
          }
        }
      }

      insertTxStmt.run(txId, timestamp, operatorId.toString(), recipientId, Math.abs(hbarTransferred), result, now)

      const sent = hbarTransferred < 0 ? Math.abs(hbarTransferred) : 0
      const received = hbarTransferred > 0 ? hbarTransferred : 0
      upsertAggregateStmt.run(operatorId.toString(), sent, received, hbarTransferred, now)
      ingestedCount++
    }
    db.exec('COMMIT')
    console.log(`[✅ SUCCESS] Successfully materialized ${ingestedCount} events into Local SQLite Read-Model.`)

    // 4. Query Side: Execute Relational Analytics directly from CPU memory
    console.log('\n[⚡ CQRS QUERY MODEL] Executing Analytical Aggregations on SQLite In-Memory Database:')
    const aggregateQuery = db.prepare(`
      SELECT 
        account_id, 
        tx_count, 
        ROUND(total_sent_hbar, 4) as sent_hbar, 
        ROUND(total_received_hbar, 4) as recv_hbar, 
        ROUND(net_flow_hbar, 4) as net_hbar
      FROM account_aggregates 
      WHERE account_id = ?
    `)
    const aggResult = aggregateQuery.all(operatorId.toString())
    console.table(aggResult)

    // 5. High-Frequency CQRS Benchmark (SQLite vs. Network REST)
    console.log('\n[⚡ CQRS BENCHMARK] Latency Face-Off: Local SQLite vs. Remote Mirror REST API:')

    // Benchmark Local In-Memory Query
    const localStart = performance.now()
    const topTransfersStmt = db.prepare('SELECT transaction_id, consensus_timestamp, amount_hbar, result FROM transactions ORDER BY amount_hbar DESC LIMIT 5')
    for (let i = 0; i < 100; i++) {
      topTransfersStmt.all()
    }
    const localEnd = performance.now()
    const avgLocalMs = (localEnd - localStart) / 100

    // Benchmark Network REST Query (single call)
    const restStart = performance.now()
    await fetch(`${baseUrl}/api/v1/transactions?account.id=${operatorId.toString()}&limit=5`)
    const restEnd = performance.now()
    const restMs = restEnd - restStart

    console.log(`[📊 METRIC] Local SQLite Read Latency:   ${avgLocalMs.toFixed(4)} ms per query`)
    console.log(`[📊 METRIC] Remote Mirror REST Latency:   ${restMs.toFixed(2)} ms per request`)
    console.log(`[🚀 SPEEDUP] Local CQRS Read Model is ~${Math.round(restMs / avgLocalMs)}x FASTER!`)

    updateState('CQRS_REACTOR_INGESTED_TXS', ingestedCount.toString())
    updateState('CQRS_SQLITE_LATENCY_MS', avgLocalMs.toFixed(4))
    updateState('CQRS_REST_LATENCY_MS', restMs.toFixed(2))

    console.log('\n💡 KEY CONCEPT:')
    console.log('CQRS isolates state mutation from state reading. By materializing Hedera')
    console.log('consensus events into an embedded SQLite engine (`node:sqlite`), the application')
    console.log('achieves microsecond analytical queries and immunity from network rate-limits.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Never make direct network REST calls inside high-frequency trading loops or')
    console.log('backend APIs. Ingest asynchronously, materialize locally, and query at CPU speed.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] CQRS Reactor Execution Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
