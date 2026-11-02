/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Real-Time WebSocket Ledger Event Bus
 * [ CONCEPT ] Push-Based Reactive Event Streaming vs Polling Anti-Patterns
 * ============================================================================
 * [ KEY CONCEPT ]
 * Constantly polling the Hedera Mirror Node via HTTP REST every 500ms creates
 * massive network overhead, burns cloud egress bandwidth, and still introduces
 * hundreds of milliseconds of perceptual lag.
 *
 * Modern high-frequency fintech systems use Reactive Event Bus architectures:
 * 1. PUSH PROTOCOL: The Ledger Event Gateway maintains persistent duplex connections
 *    via WebSockets (`ws` protocol) with clients (traders, bots, dApps).
 * 2. PUB/SUB TOPICS: Clients subscribe to specific ledger channels
 *    (e.g., `account:transfers`, `hcs:messages`, `hts:mints`).
 * 3. REAL-TIME BROADCAST: When transactions settle on Hedera consensus, the gateway
 *    multiplexes structured JSON event envelopes to all active subscribers instantly.
 * *
 * [ LEARNABLE MOMENT ]
 * Polling REST endpoints in high-frequency loops creates severe network waste and latency. A reactive WebSocket or SSE event bus streams on-chain events into the client interface with sub-second real-time responsiveness.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 *
 * [ LEARNING PATH ]
 * - Previous: M2 Lab 05: Circuit Breaker & Rate Limiter
 * - Next:     M2 Lab 07: GraphQL Subgraph Indexer
 *
 * [ SIMULATED ]
 * The subscriber client runs in the same process as the server. The ledger events it relays are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M2_State_Interrogation_CQRS/06_realtime_websocket_event_bus.js
 * ============================================================================
 */

import http from 'http'
import { EventEmitter } from 'events'
import { getClient, getMirrorNodeBaseUrl, updateState, exitIfStuck } from '../M99_Utilities/index.js'

/**
 * Enterprise Reactive Ledger Event Bus.
 * Connects upstream consensus streams with downstream real-time subscribers.
 */
class LedgerEventBus extends EventEmitter {
  constructor (port = 8546) {
    super()
    this.port = port
    this.server = null
    this.activeSockets = new Set()
    this.eventsDispatched = 0
  }

  start () {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        // Support Server-Sent Events (SSE) & JSON stream endpoints
        if (req.url === '/events/stream') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'Access-Control-Allow-Origin': '*'
          })

          const listener = (event) => {
            res.write(`data: ${JSON.stringify(event)}\n\n`)
          }

          this.on('ledger_event', listener)
          this.activeSockets.add(res)

          req.on('close', () => {
            this.removeListener('ledger_event', listener)
            this.activeSockets.delete(res)
          })
          return
        }

        res.writeHead(404)
        res.end()
      })

      this.server.listen(this.port, () => {
        resolve(this.port)
      })
    })
  }

  broadcast (topic, payload) {
    this.eventsDispatched++
    const eventEnvelope = {
      protocol: 'hedera:eventbus:v1',
      topic,
      sequence: this.eventsDispatched,
      timestamp: Date.now(),
      payload
    }
    this.emit('ledger_event', eventEnvelope)
    return eventEnvelope
  }

  close () {
    return new Promise((resolve) => {
      for (const socket of this.activeSockets) socket.end()
      if (this.server) this.server.close(resolve)
      else resolve()
    })
  }
}

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'the demo server to finish')
  console.log('--- SESSION START: Real-Time WebSocket Ledger Event Bus ---\n')

  const { client, operatorId } = getClient()
  const mirrorBase = getMirrorNodeBaseUrl()
  const BUS_PORT = 8546

  const eventBus = new LedgerEventBus(BUS_PORT)

  try {
    console.log(`[⚙️ PROCESS] Step 1: Starting reactive ledger event gateway on port ${BUS_PORT}...`)
    await eventBus.start()
    console.log(`[✅ SUCCESS] Event Bus Gateway running on http://127.0.0.1:${BUS_PORT}/events/stream`)

    console.log('\n[⚙️ PROCESS] Step 2: Simulating downstream subscriber connection (SSE/WebSocket client)...')

    const receivedEvents = []

    // Connect client consumer via native HTTP SSE streaming
    const consumerReq = http.request(`http://127.0.0.1:${BUS_PORT}/events/stream`, (res) => {
      res.on('data', (chunk) => {
        const text = chunk.toString()
        const lines = text.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const rawJson = line.replace('data: ', '').trim()
            if (rawJson) {
              const parsed = JSON.parse(rawJson)
              receivedEvents.push(parsed)
              console.log(`[📥 EVENT ARRIVED] Topic: ${parsed.topic} | Seq: #${parsed.sequence} | Tx: ${parsed.payload.txId}`)
            }
          }
        }
      })
    })
    consumerReq.end()

    // Wait 200ms for subscription handshake
    await new Promise(r => setTimeout(r, 200))

    console.log('\n[⚙️ PROCESS] Step 3: Fetching live consensus events from Mirror Node to ingest into Event Bus...')
    const mirrorRes = await fetch(`${mirrorBase}/api/v1/transactions?limit=3&order=desc`)
    if (!mirrorRes.ok) throw new Error(`Mirror Node error: ${mirrorRes.statusText}`)
    const mirrorData = await mirrorRes.json()

    console.log(`[⚙️ PROCESS] Step 4: Broadcasting ${mirrorData.transactions.length} live consensus events to subscribers...`)

    for (const tx of mirrorData.transactions) {
      const payer = tx.payer_account_id || tx.transaction_id.split('-')[0]
      const envelope = eventBus.broadcast(`account:transfers:${payer}`, {
        txId: tx.transaction_id,
        consensusTimestamp: tx.consensus_timestamp,
        result: tx.result,
        name: tx.name,
        chargedFee: (tx.charged_tx_fee / 1e8) + ' ℏ'
      })
      await new Promise(r => setTimeout(r, 100))
    }

    // Wait for client to process
    await new Promise(r => setTimeout(r, 300))

    console.log('\n--- 📡 REACTIVE STREAMING SUMMARY ---')
    console.log(`🔹 Total Events Broadcasted: ${eventBus.eventsDispatched}`)
    console.log(`🔹 Total Events Received:    ${receivedEvents.length}`)
    console.log(`🔹 Delivery Integrity:       ${receivedEvents.length === eventBus.eventsDispatched ? '100% (ZERO PACKET LOSS)' : 'PARTIAL'}`)

    updateState('EVENT_BUS_LAST_PORT', BUS_PORT)
    updateState('EVENT_BUS_EVENTS_PROCESSED', receivedEvents.length)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Push Over Pull: By transforming Mirror Node consensus feeds into push-based')
    console.log('event streams, reactive interfaces (React dashboards, automated trading engines)')
    console.log('update the instant consensus finality occurs, eliminating polling bottlenecks.')

    consumerReq.destroy()
    await eventBus.close()
    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error(`\n[❌ FAILED] Event Bus Error: ${error.message}`)
    process.exitCode = 1
    await eventBus.close()
    if (client) client.close()
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
