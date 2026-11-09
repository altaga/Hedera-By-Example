/**
 * ============================================================================
 * Lab 01: Hedera Fundamentals - aBFT & Consensus Simulation
 * [CONCEPT] Gossip about Gossip & Virtual Voting
 * ============================================================================
 * [ KEY CONCEPT ]
 * Virtual Voting: Because every node has the full history of everyone else's
 * gossip, they can calculate what everyone else is thinking without sending
 * extra votes over the network. This is why Hedera is "Fair" and "Fast".
 *
 *
 * [ LEARNABLE MOMENT ]
 * Unlike Proof-of-Work blockchains that suffer from probabilistic finality and block reorganizations, Hashgraph is asynchronous Byzantine Fault Tolerant (aBFT): once a transaction reaches consensus, usually within a few seconds, it is final and cannot be reorganized away.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hedera.com/learning/consensus-algorithms/what-is-asynchronous-byzantine-fault-tolerance-abft
 *
 * [ LEARNING PATH ]
 * - Previous: M0 Lab 06: OpenTelemetry Consensus Telemetry
 * - Next:     M1 Lab 02: State Rent & Account Lifecycle
 *
 * [ SIMULATED ]
 * The gossip between nodes runs locally as a model of the hashgraph; no network calls are made.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: none. This lab runs entirely on your machine (no network calls).
 * - Cost: free (no transactions are sent).
 *
 * [ HOW TO RUN ]
 * node English/M1_Fundamentals_Functional_JS/01_consensus_and_abft.js
 * ============================================================================
 */

import crypto from 'crypto'
import { show } from '../M99_Utilities/index.js'

/**
 * Generates a SHA-384 hash of the event data and its parents.
 * This is the 'Glue' that makes the Hashgraph unforgeable.
 */
const generateEventHash = (data, prevHash1, prevHash2) =>
  crypto.createHash('sha384').update(data + prevHash1 + prevHash2).digest('hex')

/**
 * Creates a Hashgraph Event object.
 */
const createEvent = (creator, transaction, selfParent, otherParent) => {
  const hash = generateEventHash(transaction, selfParent, otherParent)
  return {
    creator,
    transaction,
    selfParent,
    otherParent,
    timestamp: Date.now(),
    hash
  }
}

/**
 * Simulates a multi-node Gossip session.
 */
const gossipSimulation = async () => {
  console.log('--- SESSION START: Gossip about Gossip Simulation ---\n')

  console.log('[INFO] Nodes A and B start with independent "Genesis" events...')
  // Round 1: each node records its own first event; neither has heard from the other yet.
  const eventA1 = createEvent('Node A', 'Tx1: Alice pays Bob', '0x000', '0x000')
  const eventB1 = createEvent('Node B', 'Tx2: Charlie pays Dave', '0x000', '0x000')

  console.log('[PROCESS] Node A gossips to Node B.')
  console.log('-> Node B creates a NEW event linking its history (B1) with Node A\'s history (A1).')
  // Gossip: Node B hears A's event and records a new one whose parents are its own last event and A's (the 'other parent').
  const eventB2 = createEvent('Node B', 'Tx3: Dave pays Alice', eventB1.hash, eventA1.hash)

  console.log('[PROCESS] Node B gossips back to Node A.')
  console.log('-> Node A creates a NEW event linking its history (A1) with Node B\'s latest (B2).')
  // Gossip about gossip: A now learns what B knew, so every event carries the history of who told whom.
  const eventA2 = createEvent('Node A', 'Tx4: Bob pays Charlie', eventA1.hash, eventB2.hash)

  console.log('\n---  Final Hashgraph DAG Visualized ---')

  // The resulting DAG: virtual voting reads it to agree on the order without sending any votes.
  const timeline = [eventA1, eventB1, eventB2, eventA2]
  const eventIds = new Map(timeline.map((ev, i) => [ev.hash, `E${i}`]))
  show.dag({ title: 'Hashgraph: events and their parents', events: timeline.map((ev, i) => ({ id: `E${i}`, creator: ev.creator, label: ev.transaction, selfParent: eventIds.get(ev.selfParent), otherParent: eventIds.get(ev.otherParent) })) })

  timeline.forEach((ev, index) => {
    console.log(`\n[LOG] EVENT ${index} Created by: ${ev.creator}`)
    console.log(`└─ Data:         ${ev.transaction}`)
    console.log(`└─ Self-Parent:  ${ev.selfParent.substring(0, 12)}...`)
    console.log(`└─ Other-Parent: ${ev.otherParent.substring(0, 12)}...`)
    console.log(`└─ Hash:         ${ev.hash.substring(0, 12)}...`)
  })

  console.log('\n KEY CONCEPT:')
  console.log('1. Immutability: If anyone changes Tx1, Event A1\'s hash changes.')
  console.log('Because Event B2 depends on A1, B2\'s hash breaks too. The whole DAG fails.')
  console.log('2. Order: By sharing these hashes, nodes know EXACTLY when everyone heard what.')
  console.log('3. Virtual Voting: Because Node A has B2\'s parent hashes, it knows Node B\'s state.')

  console.log('\n--- SESSION COMPLETE ---')
}

// Start the simulation if run directly
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  gossipSimulation()
    .then(() => process.exit())
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}

export { createEvent, generateEventHash }
