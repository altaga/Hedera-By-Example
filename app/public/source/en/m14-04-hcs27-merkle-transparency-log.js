/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: HCS-27 Transparency Log Checkpoints & Cryptographic Merkle Proofs
 * [CONCEPT] High-Scale Off-Chain Batching with Consensus-Anchored Merkle Roots
 * ============================================================================
 * [ KEY CONCEPT ]
 * Scalable Transparency Checkpoints: When an AI agent or enterprise processes
 * tens of thousands of micro-decisions per minute, submitting each one to a separate
 * on-chain message would incur unnecessary overhead.
 * HCS-27 establishes an auditable checkpoint standard: batches of operations are
 * structured into an off-chain Merkle tree, and only the deterministic Merkle root
 * is anchored to HCS each epoch.
 * Any single operation can be proven conclusively via a compact Merkle inclusion proof.
 *
 * [ LEARNABLE MOMENT ]
 * This is the exact cryptographic technique used by Certificate Transparency (CT) logs
 * and modern zero-knowledge rollups. You achieve the economic cost of off-chain databases
 * with the mathematical finality of Hedera Hashgraph.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-27/
 * - https://hol.org/docs/libraries/standards-sdk/hcs-27/overview
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 03: HCS-26 Agent Skills Registry
 * - Next:     M14 Lab 05: Agent Audit Trail on HCS (HCS-28 Concepts)
 *
 * [SIMULATED]
 * The 64 inference logs are synthetic. The Merkle tree, the proof and the HCS checkpoint are real.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M14_Advanced_HCS_Standards_AI/04_hcs27_merkle_transparency_log.js
 * ============================================================================
 */

import crypto from 'crypto'
import { ethers } from 'ethers'
import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  Hbar
} from '@hiero-ledger/sdk'
import {
  buildHCS27TopicMemo,
  buildHCS27TransactionMemo
} from '@hashgraphonline/standards-sdk'
import { getClient, updateState, show } from '../M99_Utilities/index.js'

/**
 * Builds a Merkle Tree from an array of raw leaf strings.
 *
 * @param {Array<string>} rawItems - Array of data payloads
 * @returns {object} Tree containing layers, leaves, and root
 */
const buildMerkleTree = (rawItems) => {
  const leafHashes = rawItems.map(item => ethers.keccak256(ethers.toUtf8Bytes(item)))
  const layers = [leafHashes]

  while (layers[layers.length - 1].length > 1) {
    const currentLayer = layers[layers.length - 1]
    const nextLayer = []
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i]
      const right = i + 1 < currentLayer.length ? currentLayer[i + 1] : left
      const combined = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [left, right])
      nextLayer.push(combined)
    }
    layers.push(nextLayer)
  }

  return {
    root: layers[layers.length - 1][0],
    leaves: leafHashes,
    layers
  }
}

/**
 * Generates a Merkle inclusion proof for a leaf at a given index.
 *
 * @param {object} tree - Merkle tree object
 * @param {number} leafIndex - Index of target leaf
 * @returns {Array<object>} Array of sibling proof steps
 */
const getMerkleProof = (tree, leafIndex) => {
  const proof = []
  let index = leafIndex

  for (let i = 0; i < tree.layers.length - 1; i++) {
    const layer = tree.layers[i]
    const isRight = index % 2 === 1
    const siblingIndex = isRight ? index - 1 : index + 1
    const sibling = siblingIndex < layer.length ? layer[siblingIndex] : layer[index]

    proof.push({
      position: isRight ? 'left' : 'right',
      hash: sibling
    })
    index = Math.floor(index / 2)
  }

  return proof
}

/**
 * Verifies a Merkle inclusion proof against a known root.
 *
 * @param {string} leafHash - Hash of the item to verify
 * @param {Array<object>} proof - Proof steps
 * @param {string} root - Expected Merkle root
 * @returns {boolean} True if leaf belongs to root
 */
const verifyMerkleProof = (leafHash, proof, root) => {
  let computed = leafHash

  for (const step of proof) {
    if (step.position === 'left') {
      computed = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [step.hash, computed])
    } else {
      computed = ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [computed, step.hash])
    }
  }

  return computed === root
}

const main = async () => {
  console.log('--- SESSION START: HCS-27 Merkle Transparency Checkpoints ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Create HCS-27 Checkpoint Topic
    const topicMemo = buildHCS27TopicMemo()
    console.log(`[PROCESS] Initializing HCS-27 Transparency Log Topic (Memo: ${topicMemo})...`)
    // Create the topic: an ordered, timestamped message log; a submit key would restrict who can write.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo(topicMemo)
      .execute(client)

    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[SUCCESS] HCS-27 Topic Created: ${topicId}`)

    // 2. Simulate 64 High-Frequency Off-Chain Inferences / Decisions
    const batchSize = 64
    console.log(`\n[PROCESS] Synthesizing ${batchSize} high-frequency off-chain AI inference logs...`)
    const rawInferences = []
    for (let i = 0; i < batchSize; i++) {
      rawInferences.push(JSON.stringify({
        opId: `inf_${i.toString().padStart(4, '0')}`,
        model: 'deepseek-r1-qwen',
        promptTokens: 120 + (i * 3),
        confidence: 0.95 + (i * 0.0005),
        resultHash: crypto.createHash('sha256').update(`inference_payload_${i}`).digest('hex')
      }))
    }

    // 3. Construct Merkle Tree
    console.log('[PROCESS] Building cryptographic Merkle tree over batch...')
    const merkleTree = buildMerkleTree(rawInferences)
    console.log(`[SUCCESS] Merkle Tree Constructed across ${merkleTree.layers.length} layers!`)
    console.log(`[LOG] Calculated Merkle Root: ${merkleTree.root}`)

    // 4. Assemble HCS-27 Checkpoint Payload
    const checkpoint = {
      standard: 'hcs-27',
      version: '1.0.0',
      epoch: 108,
      treeSize: batchSize,
      merkleRoot: merkleTree.root,
      operator: operatorId.toString(),
      timestamp: new Date().toISOString()
    }

    console.log('\n[PROCESS] Anchoring HCS-27 Checkpoint to Hedera Consensus...')
    // Publish: consensus gives the message a sequence number and a timestamp everyone agrees on.
    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setTransactionMemo(buildHCS27TransactionMemo())
      .setMessage(JSON.stringify(checkpoint))
      .execute(client)

    const submitReceipt = await submitTx.getReceipt(client)
    const seqNum = submitReceipt.topicSequenceNumber.toString()
    console.log(`[SUCCESS] Checkpoint Anchored! Sequence #${seqNum} on Topic ${topicId}`)

    // 5. Generate and Verify Inclusion Proof for a Target Item (e.g., Inference #42)
    const targetIndex = 42
    const targetPayload = rawInferences[targetIndex]
    const targetLeafHash = merkleTree.leaves[targetIndex]

    console.log(`\n[PROCESS] Generating cryptographic Merkle inclusion proof for Inference #${targetIndex}...`)
    const proof = getMerkleProof(merkleTree, targetIndex)
    show.merkle({ title: 'Merkle inclusion proof for inference #42', leafCount: merkleTree.leaves.length, leafIndex: targetIndex, root: merkleTree.root, proof: proof.map((p) => p.hash.toString('hex')) })

    console.log(`[LOG] Proof Steps Count:   ${proof.length} hashes (log2(${batchSize}) = 6 steps)`)
    console.log(`[LOG] Target Leaf Hash:    ${targetLeafHash}`)

    const isProofValid = verifyMerkleProof(targetLeafHash, proof, merkleTree.root)
    console.log(`\n[AUDIT] Cryptographic Verification: ${isProofValid ? 'VERIFIED (100% INCLUDED)' : 'FRAUDULENT'}`)

    if (!isProofValid) throw new Error('Merkle inclusion proof verification failed!')

    // Persist state
    updateState('HCS27_TOPIC_ID', topicId)
    updateState('HCS27_EPOCH', checkpoint.epoch)
    updateState('HCS27_MERKLE_ROOT', merkleTree.root)
    updateState('HCS27_VERIFIED_LEAF', targetLeafHash)

    console.log('\n KEY CONCEPT:')
    console.log('HCS-27 gives you the best of both worlds: Millions of micro-operations run off-chain')
    console.log('with zero network congestion, while a single periodic HCS message establishes')
    console.log('unbreakable, mathematically verifiable truth on Hedera.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Batching 10,000 operations into a single Merkle root reduces consensus fees by 99.99%')
    console.log('while preserving 100% mathematical and legal auditability.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] HCS-27 Execution Failure:', error.message)
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
