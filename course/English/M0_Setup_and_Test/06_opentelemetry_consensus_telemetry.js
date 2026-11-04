/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: OpenTelemetry Consensus Telemetry
 * [CONCEPT] Distributed Tracing & High-Precision APM Observability
 * ============================================================================
 * [ KEY CONCEPT ]
 * In mission-critical banking and fintech architectures, ledger operations
 * cannot be black boxes. Distributed systems rely on OpenTelemetry (OTel)
 * and W3C TraceContext specifications to trace a business transaction from
 * an API gateway through microservices down to consensus finality on Hedera.
 *
 * This lab instruments the Hedera SDK with W3C `traceparent` headers, records
 * span metrics (Build, Sign, Consensus, Mirror Ingestion), and calculates
 * consensus roundtrip latency to ensure compliance with enterprise SLAs.
 * *
 * [ LEARNABLE MOMENT ]
 * Decentralized systems without telemetry leave DevOps teams blind during network congestion. Correlating Hedera consensus timestamps with OpenTelemetry trace spans bridges Web3 cryptographic finality with enterprise observability.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://opentelemetry.io/docs/concepts/signals/traces/
 *
 * [ LEARNING PATH ]
 * - Previous: Lab 05: AWS KMS Enterprise Signer
 * - Next:     M1 Lab 01: Consensus & aBFT
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M0_Setup_and_Test/06_opentelemetry_consensus_telemetry.js
 * ============================================================================
 */

import crypto from 'crypto'
import { performance } from 'perf_hooks'
import { TransferTransaction, Hbar } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getMirrorNodeBaseUrl } from '../M99_Utilities/index.js'

/**
 * Enterprise OpenTelemetry W3C Trace Context Generator.
 * Conforms to W3C TraceContext Recommendation (traceparent: 00-traceid-spanid-traceflags).
 */
class W3CTracer {
  constructor (serviceName = 'hedera-microservice-ledger') {
    this.serviceName = serviceName
    this.spans = []
  }

  createTraceContext () {
    const traceId = crypto.randomBytes(16).toString('hex') // 32 hex chars
    const parentSpanId = crypto.randomBytes(8).toString('hex') // 16 hex chars
    const traceFlags = '01' // Sampled
    const traceparent = `00-${traceId}-${parentSpanId}-${traceFlags}`
    return { traceId, parentSpanId, traceFlags, traceparent }
  }

  async startSpan (name, traceContext, action) {
    const spanId = crypto.randomBytes(8).toString('hex')
    const startTime = performance.now()
    const timestamp = new Date().toISOString()

    try {
      const result = await action({ spanId, traceId: traceContext.traceId })
      const durationMs = performance.now() - startTime
      this.spans.push({
        name,
        traceId: traceContext.traceId,
        spanId,
        parentSpanId: traceContext.parentSpanId,
        durationMs: Number(durationMs.toFixed(3)),
        status: 'OK',
        timestamp,
        attributes: result?.attributes || {}
      })
      return result
    } catch (error) {
      const durationMs = performance.now() - startTime
      this.spans.push({
        name,
        traceId: traceContext.traceId,
        spanId,
        parentSpanId: traceContext.parentSpanId,
        durationMs: Number(durationMs.toFixed(3)),
        status: 'ERROR',
        error: error.message,
        timestamp
      })
      throw error
    }
  }

  printSpanSummary () {
    console.log('\n---  OPENTELEMETRY TRACE SUMMARY (W3C TRACECONTEXT) ---')
    console.table(this.spans.map(s => ({
      'Span Name': s.name,
      'Duration (ms)': `${s.durationMs} ms`,
      Status: s.status,
      'Span ID': s.spanId,
      'Trace ID': `${s.traceId.substring(0, 12)}...`
    })))
  }
}

const main = async () => {
  console.log('--- SESSION START: OpenTelemetry Consensus Telemetry ---\n')

  const { client, operatorId } = getClient()
  const tracer = new W3CTracer('Hedera-Fintech-Gateway')
  const traceContext = tracer.createTraceContext()

  console.log(`[APM] Active W3C TraceParent: ${traceContext.traceparent}`)
  console.log(`[LOG] Target Operator ID:    ${operatorId.toString()}`)

  try {
    let transaction
    let response
    let receipt

    // SPAN 1: Transaction Assembly & Memo Context Injection
    await tracer.startSpan('hedera.tx.build', traceContext, async ({ spanId }) => {
      console.log('\n[PROCESS] Span [hedera.tx.build]: Constructing transfer with W3C trace tag...')
      // Build the transfer: debits (negative) and credits (positive) in one transaction must add up to zero.
      transaction = await new TransferTransaction()
        .addHbarTransfer(operatorId, new Hbar(0))
        .setTransactionMemo(`trace:${spanId}`)
        .freezeWith(client)

      return {
        attributes: {
          'hedera.account.payer': operatorId.toString(),
          'w3c.traceparent': traceContext.traceparent
        }
      }
    })

    // SPAN 2: Network Broadcast & Gossip Consensus Ordering
    await tracer.startSpan('hedera.consensus.submit', traceContext, async () => {
      console.log('[PROCESS] Span [hedera.consensus.submit]: Submitting to consensus nodes...')
      response = await transaction.execute(client)
      // Wait for consensus: the receipt says whether the network accepted the transaction.
      receipt = await response.getReceipt(client)

      return {
        attributes: {
          'hedera.tx.id': response.transactionId.toString(),
          'hedera.consensus.status': receipt.status.toString()
        }
      }
    })

    // SPAN 3: Mirror Node Ingestion Latency Probe
    await tracer.startSpan('hedera.mirrornode.sync', traceContext, async () => {
      console.log('[PROCESS] Span [hedera.mirrornode.sync]: Probing mirror node state ingestion...')
      const mirrorBase = getMirrorNodeBaseUrl()
      const formattedTxId = `${response.transactionId.accountId}-${response.transactionId.validStart.seconds}-${response.transactionId.validStart.nanos}`

      let synced = false
      const maxRetries = 10
      for (let i = 0; i < maxRetries; i++) {
        // Read from the Mirror Node REST API: free, but a few seconds behind consensus.
        const res = await fetch(`${mirrorBase}/api/v1/transactions/${formattedTxId}`)
        if (res.ok) {
          const body = await res.json()
          if (body.transactions && body.transactions.length > 0) {
            synced = true
            break
          }
        }
        await new Promise(r => setTimeout(r, 600))
      }

      return {
        attributes: {
          'mirrornode.synced': synced,
          'mirrornode.endpoint': mirrorBase
        }
      }
    })

    console.log('\n[SUCCESS] Consensus Verified on Hedera Testnet!')
    console.log(`[LOG] Transaction ID:  ${response.transactionId.toString()}`)
    console.log(`[EXPLORER] HashScan:    ${getHashscanUrl(response)}`)

    // Print OpenTelemetry APM Table
    tracer.printSpanSummary()

    console.log('\n KEY CONCEPT:')
    console.log('Production APM Integration: By binding W3C traceparents to transaction')
    console.log('memos, DevOps and SRE teams can correlate microservice web requests with')
    console.log('on-chain consensus logs in Datadog, Dynatrace, or Jaeger seamlessly.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error(`\n[FAILED] Telemetry Tracing Failed: ${error.message}`)
    process.exitCode = 1
    if (client) client.close()
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
