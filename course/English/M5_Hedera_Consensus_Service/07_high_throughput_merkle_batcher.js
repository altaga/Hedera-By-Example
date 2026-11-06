/**
 * ============================================================================
 * Lab 07: High-Throughput Merkle Batch Ingestion Engine & L1 Inclusion Proofs
 * [CONCEPT] Compressing High-Frequency Event Streams into Sub-Cent Consensus Anchors
 * ============================================================================
 * [ KEY CONCEPT ]
 * In enterprise architectures (IoT telemetry, supply chain tracking, high-speed
 * fintech ledgers), sending thousands of individual transactions per second to any
 * network creates cost and processing bottlenecks.
 * The Merkle Batch Ingestion pattern achieves infinite scalability:
 * 1. Off-Chain Event Ingestion: Microservices buffer high-frequency events in memory.
 * 2. Merkle Root Computation: The engine groups events into a binary Keccak-256
 *    Merkle Tree and computes a 32-byte cryptographic root.
 * 3. HCS Anchor: The engine commits ONLY the Merkle root to an HCS Topic. Hedera
 *    stamps the immutable network consensus timestamp on the entire batch for $0.0001.
 * 4. Logarithmic Inclusion Proof: A light client with a single payload verifies that
 *    their record was anchored on Hedera using a compact O(log N) Merkle branch proof
 *    without downloading the rest of the dataset.
 *
 * [ LEARNABLE MOMENT ]
 * Consensus is the anchor of truth, not a bulk storage dump. Moving sequence
 * verification off-chain while anchoring Merkle roots on HCS allows enterprise
 * pipelines to handle 100,000+ operations/sec at fractional-cent cost.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ LEARNING PATH ]
 * - Previous: M5 Lab 06: HIP-991 Paid Topics
 * - Next:     M5 Lab 08: Enterprise Kafka Streaming Bridge
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M5_Hedera_Consensus_Service/07_high_throughput_merkle_batcher.js
 * ============================================================================
 */

import { ethers } from 'ethers'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState, show } from '../M99_Utilities/index.js'

/**
 * High-Throughput In-Memory Merkle Tree Generator & Verifier
 */
class MerkleTreeEngine {
  constructor (leaves) {
    this.leaves = leaves.map(l => (typeof l === 'string' && l.startsWith('0x') ? l : ethers.keccak256(ethers.toUtf8Bytes(l))))
    this.layers = [this.leaves]
    this.buildTree()
  }

  buildTree () {
    let current = this.leaves
    while (current.length > 1) {
      const next = []
      for (let i = 0; i < current.length; i += 2) {
        const left = current[i]
        const right = i + 1 < current.length ? current[i + 1] : left
        const combined = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [left, right])
        next.push(combined)
      }
      this.layers.push(next)
      current = next
    }
  }

  getRoot () {
    return this.layers[this.layers.length - 1][0]
  }

  getProof (leafIndex) {
    const proof = []
    let index = leafIndex
    for (let i = 0; i < this.layers.length - 1; i++) {
      const layer = this.layers[i]
      const isRight = index % 2 === 1
      const pairIndex = isRight ? index - 1 : (index + 1 < layer.length ? index + 1 : index)
      proof.push({
        position: isRight ? 'left' : 'right',
        hash: layer[pairIndex]
      })
      index = Math.floor(index / 2)
    }
    return proof
  }

  static verifyProof (leaf, proof, expectedRoot) {
    let currentHash = typeof leaf === 'string' && leaf.startsWith('0x') ? leaf : ethers.keccak256(ethers.toUtf8Bytes(leaf))
    for (const step of proof) {
      if (step.position === 'left') {
        currentHash = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [step.hash, currentHash])
      } else {
        currentHash = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [currentHash, step.hash])
      }
    }
    return currentHash.toLowerCase() === expectedRoot.toLowerCase()
  }
}

const main = async () => {
  console.log('--- SESSION START: High-Throughput Merkle Batch Ingestion Engine (HCS) ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Deploy an Audit Anchor HCS Topic
    console.log('[PROCESS] Step 1: Deploying Immutable HCS Audit Anchor Topic...')
    // Create the topic: an ordered, timestamped message log; a submit key would restrict who can write.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('ENTERPRISE:MERKLE_BATCH_ANCHOR:V1')
      .execute(client)

    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId
    console.log(`[SUCCESS] HCS Anchor Topic Created: ${topicId.toString()}`)

    // 2. Simulate High-Throughput Telemetry Event Stream (1,024 High-Speed Records)
    const BATCH_SIZE = 1024
    console.log(`\n[PROCESS] Step 2: Ingesting Stream of ${BATCH_SIZE} High-Frequency Enterprise Records in Memory...`)
    const rawEvents = []
    const sampleTargetIndex = 427

    for (let i = 0; i < BATCH_SIZE; i++) {
      rawEvents.push(JSON.stringify({
        seq: i + 1,
        source: `sensor-node-${(i % 16) + 1}`,
        metric: 'temperature_celsius',
        value: 20 + ((i * 17) % 150) / 10,
        ts: Date.now() - (BATCH_SIZE - i) * 10
      }))
    }
    console.log(`[LOG] Ingestion buffer full: ${rawEvents.length} telemetry packets processed.`)
    console.log(`[TARGET] Designating Audit Target Event #${sampleTargetIndex}:`)
    console.log(`${rawEvents[sampleTargetIndex]}`)

    // 3. Compute Cryptographic Merkle Tree
    console.log('\n[PROCESS] Step 3: Computing Keccak-256 Binary Merkle Tree...')
    const merkleEngine = new MerkleTreeEngine(rawEvents)
    const merkleRoot = merkleEngine.getRoot()
    console.log(`[ CRYPTO ROOT] Batch Merkle Root: ${merkleRoot}`)
    console.log(`[ TREE METRICS] Depth: ${merkleEngine.layers.length} layers | Leaves: ${BATCH_SIZE}`)

    // 4. Anchor Merkle Root Commitment to HCS
    console.log('\n[PROCESS] Step 4: Anchoring Merkle Root Commitment to Hedera Consensus Layer...')
    const anchorPayload = {
      protocol: 'hcs-merkle-batch-v1',
      merkle_root: merkleRoot,
      batch_size: BATCH_SIZE,
      batch_id: 'BATCH-2026-OCT-8842',
      operator: operatorId.toString(),
      anchored_at: new Date().toISOString()
    }

    // Publish: consensus gives the message a sequence number and a timestamp everyone agrees on.
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(anchorPayload))
      .setTransactionMemo('HCS:BATCH_ROOT_COMMIT')
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    console.log(`[SUCCESS] Merkle Root Anchored at Consensus Sequence #${submitReceipt.topicSequenceNumber}!`)
    console.log('[ COST EFFICIENCY] 1,024 Events Anchored in ONE Tx (~$0.0001 total consensus fee)')

    // 5. Generate and Verify Inclusion Proof for Target Event
    console.log(`\n[PROCESS] Step 5: Generating Compact O(log N) Inclusion Proof for Event #${sampleTargetIndex}...`)
    const inclusionProof = merkleEngine.getProof(sampleTargetIndex)
    console.log(`[ PROOF COMPRESSION] Proof Size: Only ${inclusionProof.length} 32-byte hashes for ${BATCH_SIZE} events!`)

    console.log('[PROCESS] Light-Client Independent Verification:')
    const isValid = MerkleTreeEngine.verifyProof(rawEvents[sampleTargetIndex], inclusionProof, merkleRoot)
    show.merkle({ title: 'Inclusion proof for one event in the batch', leafCount: rawEvents.length, leafIndex: sampleTargetIndex, root: merkleRoot, proof: inclusionProof.map((p) => p.hash.toString('hex')) })
    console.log(`[ CRYPTO PROOF] Verification Result: ${isValid ? 'VERIFIED VALID (Cryptographic Match)' : 'REJECTED'}`)

    updateState('MERKLE_BATCH_TOPIC_ID', topicId.toString())
    updateState('MERKLE_BATCH_ROOT', merkleRoot)
    updateState('MERKLE_BATCH_SIZE', BATCH_SIZE.toString())

    console.log('\n KEY CONCEPT:')
    console.log('The Merkle Batch Ingestion Engine enables infinite horizontal scaling.')
    console.log('By committing a single Keccak-256 Merkle root to HCS, thousands of events')
    console.log('inherit Hedera\'s immutable network timestamp and fair consensus ordering.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('External clients only need an O(log N) branch proof (10 hashes for 1,024 events)')
    console.log('to mathematically prove tamper-proof inclusion against the public consensus record.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Merkle Batcher Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
