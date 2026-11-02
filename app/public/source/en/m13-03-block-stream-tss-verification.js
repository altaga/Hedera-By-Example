/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Hedera Block Streams & Aggregated TSS Verification (HIP-1056)
 * [ CONCEPT ] Unified Block Ingestion with Cryptographic Threshold Proofs
 * ============================================================================
 * [ KEY CONCEPT ]
 * Unified Block Stream: Hedera historically streamed raw record files (.rcd)
 * from each individual node. HIP-1056 modernizes this by producing a unified
 * Block Stream signed with Threshold Signature Schemes (TSS).
 * Every block contains a block header, transaction roots, state change roots,
 * and an aggregated cryptographic signature proving that a 2/3+ stake threshold
 * of consensus nodes ratified the block.
 *
 * [ LEARNABLE MOMENT ]
 * Light clients and L2 zk-rollup verifiers cannot parse gigabytes of individual
 * node record files. A unified Block Stream with compact TSS proofs allows any
 * mobile wallet or smart contract to verify Hedera finality in O(1) time.
 *
 * [ LEARNING PATH ]
 * - Previous: M13 Lab 02: Native Delegated Fee Sponsorship (HIP-1068)
 * - Next:     M13 Lab 04: Block Node Discovery & Data Lake (HIP-1081 / HIP-1137)
 *
 * [ SIMULATED ]
 * The TSS quorum verification is simulated (HIP-1056 is not live yet).
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M13_Cross_Ledger_and_Data_Streams/03_block_stream_tss_verification.js
 * ============================================================================
 */

import crypto from 'crypto'
import { ethers } from 'ethers'
import { getClient, updateState, show } from '../M99_Utilities/index.js'

/**
 * Fetches the latest confirmed block and its transactions from the Hedera Mirror Node.
 *
 * @param {string} network - 'testnet' | 'mainnet'
 * @returns {Promise<{block: object, transactions: Array<object>}>} Live block and transactions
 */
const fetchLatestBlockAndTxs = async (network = 'testnet') => {
  const baseUrl = `https://${network}.mirrornode.hedera.com/api/v1`
  const res = await fetch(`${baseUrl}/blocks?order=desc&limit=1`)
  if (!res.ok) {
    throw new Error(`Failed to fetch block stream: HTTP ${res.status}`)
  }
  const data = await res.json()
  if (!data.blocks || data.blocks.length === 0) {
    throw new Error('No blocks returned by Mirror Node')
  }
  const block = data.blocks[0]

  // Fetch actual transactions inside this block's consensus timestamp window
  const txRes = await fetch(
    `${baseUrl}/transactions?timestamp=gte:${block.timestamp.from}&timestamp=lte:${block.timestamp.to}&limit=25`
  )
  const txData = txRes.ok ? await txRes.json() : { transactions: [] }
  return { block, transactions: txData.transactions || [] }
}

/**
 * Computes a deterministic Merkle root over live Mirror Node transaction hashes.
 *
 * @param {Array<object>} transactions - Live transactions from the block window
 * @param {string} fallbackSeed - Fallback hash if block had 0 user transactions
 * @returns {string} Merkle root hex string
 */
const computeTransactionsMerkleRoot = (transactions, fallbackSeed) => {
  if (!transactions || transactions.length === 0) {
    return ethers.keccak256(ethers.toUtf8Bytes(fallbackSeed))
  }
  let layer = transactions.map(tx =>
    ethers.keccak256(ethers.toUtf8Bytes(tx.transaction_hash || tx.transaction_id))
  )
  while (layer.length > 1) {
    const next = []
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]
      const right = i + 1 < layer.length ? layer[i + 1] : left
      next.push(ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [left, right]))
    }
    layer = next
  }
  return layer[0]
}

/**
 * Computes deterministic Block Hash according to HIP-1056 specification.
 *
 * @param {object} header - Block header components
 * @returns {string} Calculated block hash (hex)
 */
const calculateBlockHash = (header) => {
  const payload = [
    header.number.toString(),
    header.previousBlockHash,
    header.timestampStart,
    header.timestampEnd,
    header.transactionsRoot,
    header.stateChangesRoot
  ].join('|')

  return crypto.createHash('sha384').update(payload).digest('hex')
}

/**
 * [ARCHITECTURAL SIMULATION]
 * Validates the aggregated Threshold Signature Scheme (TSS) quorum against an
 * authorized validator roster.
 *
 * @param {string} blockHash - Recomputed block hash
 * @param {object} tssProof - Quorum signatures and threshold specification
 * @param {Array<string>} authorizedRoster - Expected validator addresses
 * @returns {boolean} True if threshold is satisfied by authorized validators
 */
const verifyTSSBlockQuorum = (blockHash, tssProof, authorizedRoster) => {
  const messageDigest = ethers.keccak256(ethers.toUtf8Bytes(blockHash))
  const rosterSet = new Set(authorizedRoster.map(a => a.toLowerCase()))
  const seen = new Set()
  let validSignatures = 0

  for (const sigItem of tssProof.signatures) {
    const recovered = ethers.recoverAddress(messageDigest, sigItem.signature).toLowerCase()
    if (rosterSet.has(recovered) && !seen.has(recovered)) {
      seen.add(recovered)
      validSignatures++
    }
  }

  const thresholdRatio = validSignatures / tssProof.totalStakeUnits
  return thresholdRatio >= tssProof.minQuorumRatio
}

const main = async () => {
  console.log('--- SESSION START: Block Streams & Aggregated TSS (HIP-1056) ---\n')
  const { network } = getClient()

  try {
    console.log(`[⚙️ PROCESS] Ingesting LIVE latest block from Hedera ${network} Mirror Node...`)
    const { block: liveBlock, transactions: liveTxs } = await fetchLatestBlockAndTxs(network)

    console.log('[✅ SUCCESS] Live Block Stream Frame Ingested:')
    console.log(`[📊 LOG] Block Number:       #${liveBlock.number}`)
    console.log(`[📊 LOG] Consensus Window:   ${liveBlock.timestamp.from} -> ${liveBlock.timestamp.to}`)
    console.log(`[📊 LOG] Block Record Count: ${liveBlock.count} (Sampled ${liveTxs.length} live tx hashes)`)
    console.log(`[📊 LOG] Previous Hash:      ${liveBlock.previous_hash.slice(0, 32)}...`)
    console.log(`[📊 LOG] Official Hash:      ${liveBlock.hash.slice(0, 32)}...`)

    // 2. Compute Merkle Root over live transactions & construct HIP-1056 Block Header
    console.log('\n[⚙️ PROCESS] Computing Merkle Root over live block transactions & reconstructing header...')
    const txMerkleRoot = computeTransactionsMerkleRoot(liveTxs, liveBlock.hash)
    show.merkle({ title: 'Merkle tree over the block transactions', leafCount: Math.max(liveTxs.length, 1), root: txMerkleRoot })
    const blockHeader = {
      number: liveBlock.number,
      previousBlockHash: liveBlock.previous_hash,
      timestampStart: liveBlock.timestamp.from,
      timestampEnd: liveBlock.timestamp.to,
      transactionsRoot: txMerkleRoot,
      stateChangesRoot: ethers.keccak256(ethers.toUtf8Bytes(`state:${liveBlock.hash}`))
    }

    const calculatedHash = calculateBlockHash(blockHeader)
    console.log(`[📊 LOG] Transactions Merkle Root: ${txMerkleRoot}`)
    console.log(`[📊 LOG] Canonical Header Digest:  ${calculatedHash.slice(0, 48)}...`)

    // 3. [ARCHITECTURAL SIMULATION] Assemble and verify TSS consensus quorum
    console.log('\n[⚙️ PROCESS] [ARCHITECTURAL SIMULATION] Verifying HIP-1056 TSS Consensus Quorum...')

    const councilPrivateKeys = [
      '0x1111111111111111111111111111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333333333333333333333333333',
      '0x4444444444444444444444444444444444444444444444444444444444444444'
    ]
    const validatorWallets = councilPrivateKeys.map(k => new ethers.Wallet(k))
    const authorizedRoster = validatorWallets.map(w => w.address)

    const blockDigest = ethers.keccak256(ethers.toUtf8Bytes(calculatedHash))
    const signatures = validatorWallets.map(w => ({
      validatorAddress: w.address,
      signature: w.signingKey.sign(blockDigest).serialized
    }))

    const tssProof = {
      algorithm: 'TSS-HIP-1056-SIM',
      minQuorumRatio: 0.667, // 2/3 Byzantine fault tolerance
      totalStakeUnits: validatorWallets.length,
      signatures
    }

    const isQuorumValid = verifyTSSBlockQuorum(calculatedHash, tssProof, authorizedRoster)
    if (!isQuorumValid) {
      throw new Error('TSS Block Quorum failed to achieve 2/3 consensus threshold!')
    }

    console.log('[✅ SUCCESS] TSS Cryptographic Quorum Verified Against Council Roster!')
    console.log(`[📊 LOG] Signers Verified:  ${signatures.length}/${tssProof.totalStakeUnits} validators`)
    console.log(`[📊 LOG] Stake Consensus:   ${(signatures.length / tssProof.totalStakeUnits * 100).toFixed(1)}% (Threshold: 66.7%)`)

    // Persist state
    updateState('BLOCK_STREAM_NUMBER', liveBlock.number)
    updateState('BLOCK_STREAM_HASH', liveBlock.hash)
    updateState('BLOCK_STREAM_TX_COUNT', liveBlock.count)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Under HIP-1056, Block Streams eliminate the fragmentation of legacy record files.')
    console.log('Every block is a cryptographically complete unit verified by a succinct TSS')
    console.log('proof, enabling trustless light clients, zk-rollups, and EVM fast-sync.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Threshold signature aggregation reduces verification complexity from O(N) to O(1),')
    console.log('making it practical to audit Hedera finality on resource-constrained devices.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Block Stream Verification Failure:', error.message)
    process.exit(1)
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
