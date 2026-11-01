/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Hedera Fundamentals - aBFT & Consensus Simulation
 * [ CONCEPT ] Gossip about Gossip & Virtual Voting
 * ============================================================================
 * [ KEY CONCEPT ]
 * Virtual Voting: Because every node has the full history of everyone else's
 * gossip, they can calculate what everyone else is thinking without sending
 * extra votes over the network. This is why Hedera is "Fair" and "Fast".
 * *
 * [ LEARNABLE MOMENT ]
 * Unlike Proof-of-Work blockchains that suffer from probabilistic finality and block reorganizations, Hashgraph reaches true asynchronous Byzantine Fault Tolerance (aBFT) in 3-5 seconds with absolute mathematical certainty.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hedera.com/learning/consensus-algorithms/what-is-asynchronous-byzantine-fault-tolerance-abft
 *
 * [ LEARNING PATH ]
 * - Previous: M0 Lab 04: Environment Provisioning
 * - Next:     M1 Lab 02: Account Rent
 *
 * [ HOW TO RUN ]
 * node 01_consensus_and_abft.js
 * ============================================================================
 */

import crypto from 'crypto'

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

  console.log('[ℹ️ INFO] Nodes A and B start with independent "Genesis" events...')
  const eventA1 = createEvent('Node A', 'Tx1: Alice pays Bob', '0x000', '0x000')
  const eventB1 = createEvent('Node B', 'Tx2: Charlie pays Dave', '0x000', '0x000')

  console.log('[⚙️ PROCESS] Node A gossips to Node B.')
  console.log('   -> Node B creates a NEW event linking its history (B1) with Node A\'s history (A1).')
  const eventB2 = createEvent('Node B', 'Tx3: Dave pays Alice', eventB1.hash, eventA1.hash)

  console.log('[⚙️ PROCESS] Node B gossips back to Node A.')
  console.log('   -> Node A creates a NEW event linking its history (A1) with Node B\'s latest (B2).')
  const eventA2 = createEvent('Node A', 'Tx4: Bob pays Charlie', eventA1.hash, eventB2.hash)

  console.log('\n--- 📊 Final Hashgraph DAG Visualized ---')

  const timeline = [eventA1, eventB1, eventB2, eventA2]

  timeline.forEach((ev, index) => {
    console.log(`\n[📊 LOG] EVENT ${index} Created by: ${ev.creator}`)
    console.log(` └─ Data:         ${ev.transaction}`)
    console.log(` └─ Self-Parent:  ${ev.selfParent.substring(0, 12)}...`)
    console.log(` └─ Other-Parent: ${ev.otherParent.substring(0, 12)}...`)
    console.log(` └─ Hash:         ${ev.hash.substring(0, 12)}...`)
  })

  console.log('\n💡 KEY CONCEPT:')
  console.log('1. Immutability: If anyone changes Tx1, Event A1\'s hash changes.')
  console.log('   Because Event B2 depends on A1, B2\'s hash breaks too. The whole DAG fails.')
  console.log('2. Order: By sharing these hashes, nodes know EXACTLY when everyone heard what.')
  console.log('3. Virtual Voting: Because Node A has B2\'s parent hashes, it knows Node B\'s state.')

  console.log('\n--- SESSION COMPLETE ---')
}

// Start the simulation if run directly
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  gossipSimulation().then(() => {
    process.exit(0)
  }).catch((error) => {
    console.error('[❌ FAILED] Execution Error:', error.message)
    process.exit(1)
  })
}

export { createEvent, generateEventHash }
