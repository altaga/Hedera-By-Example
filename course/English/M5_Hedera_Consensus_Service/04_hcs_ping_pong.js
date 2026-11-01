/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: HCS Precision Benchmarking (Latency Teardown)
 * [ CONCEPT ] Decentralized gRPC Round-Trip Latency
 * ============================================================================
 * [ KEY CONCEPT ]
 * Consensus Accuracy: Unlike local network pings, an HCS Handshake relies on
 * the network reaching a chronological agreement. The latency you see here
 * is the time it takes for a message to become "Immutable" and globally
 * recognized across all nodes. This script isolates the Submission, Ordering,
 * and Propagation phases to prove Hedera's high-performance characteristics.
 * *
 * [ LEARNABLE MOMENT ]
 * Benchmarking HCS consensus turnaround time provides empirical proof of sub-second finality. Measuring round-trip message timestamps confirms fair ordering across global consensus nodes.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/consensus-service
 *
 * [ LEARNING PATH ]
 * - Previous: M5 Lab 03: Chunking & Subscriptions
 * - Next:     M6 Lab 01: Native HFS
 *
 * [ HOW TO RUN ]
 * node 04_hcs_ping_pong.js
 * ============================================================================
 */

import {
  TopicMessageQuery,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getState } from '../M99_Utilities/index.js'

class HcsNode {
  constructor (name, client, topicId) {
    this.name = name
    this.client = client
    this.topicId = topicId
  }

  listen (messageType, onMessageCallback) {
    console.log(`[ℹ️ INFO] ${this.name}: Listener active for '${messageType}' messages.`)
    new TopicMessageQuery()
      .setTopicId(this.topicId)
      .subscribe(this.client, null, (message) => {
        const payload = Buffer.from(message.contents).toString()
        try {
          const data = JSON.parse(payload)
          if (data.msg === messageType) {
            onMessageCallback(data, message)
          }
        } catch (e) { }
      })
  }

  async send (messageType, extraData = {}) {
    const payload = JSON.stringify({
      node: this.name,
      msg: messageType,
      localTimestamp: Date.now(),
      ...extraData
    })

    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(this.topicId)
      .setMessage(payload)
      .execute(this.client)

    return await tx.getReceipt(this.client)
  }
}

const main = async () => {
  console.log('--- SESSION START: HCS Precision Latency Teardown ---\n')

  const { client } = getClient()
  const topicId = getState('HCS_TOPIC_ID')

  if (!topicId) {
    console.error('[❌ FAILED] Missing HCS_TOPIC_ID in configuration.')
    return
  }

  const nodeA = new HcsNode('NODE_A', client, topicId)
  const nodeB = new HcsNode('NODE_B', client, topicId)

  const benchmarkResults = []
  const TOTAL_CYCLES = 5
  const outboundConsensusMap = {}

  /**
   * Node B: Responder
   */
  nodeB.listen('PING', async (data) => {
    // Node B simply echoes the PING immediately
    await nodeB.send('PONG', { cycle: data.cycle, pingStart: data.localTimestamp })
  })

  /**
   * Node A (Auxiliary): Listening for OWN Ping to capture Outbound Consensus Time
   */
  nodeA.listen('PING', (data, raw) => {
    if (data.node === 'NODE_A') {
      outboundConsensusMap[data.cycle] = raw.consensusTimestamp.toDate().getTime()
    }
  })

  /**
   * Node A: Main Benchmark Processor
   */
  nodeA.listen('PONG', (data, raw) => {
    const catchTime = Date.now()
    const cycle = data.cycle

    const intervalId = setInterval(() => {
      if (outboundConsensusMap[cycle]) {
        clearInterval(intervalId)

        const startTime = data.pingStart
        const pingConsensusTime = outboundConsensusMap[cycle]
        const pongConsensusTime = raw.consensusTimestamp.toDate().getTime()

        // GRANULAR METRICS
        const outbound = pingConsensusTime - startTime // A -> Ledger
        const turnaround = pongConsensusTime - pingConsensusTime // Ledger -> B -> Ledger
        const inbound = catchTime - pongConsensusTime // Ledger -> A
        const rtt = catchTime - startTime // TOTAL

        benchmarkResults.push({ cycle, outbound, turnaround, inbound, rtt })
        console.log(`[⚙️ PROCESS] Cycle ${cycle} Processed. RTT: ${rtt}ms`)

        if (benchmarkResults.length === TOTAL_CYCLES) {
          renderFinalReport(benchmarkResults)
          console.log('\n--- SESSION COMPLETE ---')
          client.close()
          process.exit(0)
        }
      }
    }, 100)
  })

  const renderFinalReport = (results) => {
    results.sort((a, b) => a.cycle - b.cycle)

    console.log('\n' + '='.repeat(75))
    console.log('HCS PRECISION LATENCY TEARDOWN REPORT')
    console.log('='.repeat(75))
    console.log('Cycle | Outbound(A->L) | Turnaround(L->B->L) | Inbound(L->A) | TOTAL RTT')
    console.log('-'.repeat(75))
    results.forEach(res => {
      const cycleStr = res.cycle.toString().padEnd(6)
      const outStr = `${res.outbound}ms`.padEnd(15)
      const turnStr = `${res.turnaround}ms`.padEnd(21)
      const inStr = `${res.inbound}ms`.padEnd(15)
      console.log(`${cycleStr}| ${outStr}| ${turnStr}| ${inStr}| ${res.rtt}ms`)
    })
    console.log('='.repeat(75))
    console.log('[ℹ️ INFO] RTT is purely network turn-around (5s stabilization excluded).')
    console.log('='.repeat(75))
  }

  try {
    console.log('[ℹ️ INFO] Waiting for gRPC mesh stabilization (5s)...')
    await new Promise(resolve => setTimeout(resolve, 5000))

    for (let i = 1; i <= TOTAL_CYCLES; i++) {
      console.log(`\n--- Launching Handshake Cycle ${i}/${TOTAL_CYCLES} ---`)
      await nodeA.send('PING', { cycle: i })

      if (i < TOTAL_CYCLES) {
        console.log(`[ℹ️ INFO] Cycle ${i} complete. Stability pause (5s)...`)
        await new Promise(resolve => setTimeout(resolve, 5000))
      }
    }
    console.log('\nAll triggers sent. Awaiting final consensus reassembly...')

    console.log('\n💡 KEY CONCEPT:')
    console.log('Consensus Accuracy: Unlike local network pings, an HCS Ping relies on')
    console.log('the network reaching a chronological agreement. The latency you see')
    console.log('here is the time it takes for a message to become "Immutable" and')
    console.log('globally recognized.')
  } catch (error) {
    console.error('\n[❌ FAILED] Benchmark Failed:', error.message)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main().catch((error) => {
    console.error('[❌ FAILED] Execution Error:', error.message)
    process.exit(1)
  })
}
