/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 04: Block Node Discovery & Decentralized Data Lake (HIP-1081 / HIP-1137)
 * [CONCEPT] Dynamic Network Discovery & Distributed Block Lake Querying
 * ============================================================================
 * [ KEY CONCEPT ]
 * Decentralized Data Lake: In Hedera's modular architecture, consensus nodes
 * produce blocks while specialized Block Nodes (HIP-1081) store and serve them.
 * HIP-1137 provides dynamic on-chain discovery of these Block Nodes through
 * the consensus address book. This decouples transaction execution from massive
 * historical storage, enabling infinite horizontal scaling.
 *
 * [ LEARNABLE MOMENT ]
 * Consensus nodes must stay lean in RAM. Offloading historical storage to a
 * federated network of Block Nodes prevents ledger state growth from bloating
 * core validators, ensuring fixed fees and long-term decentralization.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-1081
 * - https://hips.hedera.com/hip/hip-1137
 *
 * [ LEARNING PATH ]
 * - Previous: M13 Lab 03: Block Stream & TSS Verification (HIP-1056)
 * - Next:     M13 Lab 05: Autonomous Cross-Chain Intent Settlement Engine
 *
 * [SIMULATED]
 * Block Node discovery (HIP-1137) is simulated with a local registry.
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M13_Cross_Ledger_and_Data_Streams/04_block_node_discovery_lake.js
 * ============================================================================
 */

import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Queries the live Hedera network address book via Mirror Node REST API.
 *
 * @param {string} network - 'testnet' | 'mainnet'
 * @param {number} limit - Number of consensus nodes to inspect
 * @returns {Promise<Array<object>>} Live consensus node address book entries
 */
const queryLiveNetworkNodes = async (network = 'testnet', limit = 3) => {
  const url = `https://${network}.mirrornode.hedera.com/api/v1/network/nodes?limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} querying /api/v1/network/nodes`)
  const data = await res.json()
  return data.nodes || []
}

/**
 * [ARCHITECTURAL SIMULATION]
 * Simulates on-chain dynamic discovery of registered Block Nodes (HIP-1137)
 * paired with live consensus node IDs from the Hedera address book.
 *
 * @param {string} network - 'testnet' | 'mainnet'
 * @param {Array<object>} liveNodes - Live consensus nodes from Mirror Node
 * @returns {Array<object>} List of discovered Block Node descriptors
 */
const discoverBlockNodes = (network = 'testnet', liveNodes = []) => {
  const regions = ['us-east-01', 'eu-central-01', 'ap-south-01']
  const latencies = [14, 28, 36]
  return regions.map((region, idx) => {
    const liveNode = liveNodes[idx] || {}
    return {
      nodeId: `blocknode-${region}`,
      consensusNodeAccountId: liveNode.node_account_id || `0.0.${3 + idx}`,
      endpoint: `grpc://lake-${region.split('-')[1]}.${network}.hedera.network:50211`,
      protocol: 'HIP-1081/gRPC-v1',
      supportedRange: { startBlock: 1, endBlock: 'HEAD' },
      status: 'HEALTHY',
      latencyMs: latencies[idx],
      reputationScore: Number((0.998 - idx * 0.003).toFixed(3))
    }
  })
}

/**
 * Queries a sequence of live blocks from the Hedera Mirror Node.
 *
 * @param {string} network - 'testnet' | 'mainnet'
 * @param {number} limit - Number of blocks to retrieve
 * @returns {Promise<Array<object>>} Sequence of verified blocks
 */
const queryBlockRange = async (network = 'testnet', limit = 3) => {
  const url = `https://${network}.mirrornode.hedera.com/api/v1/blocks?order=desc&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} from Mirror Node`)
  const data = await res.json()
  return data.blocks || []
}

const main = async () => {
  console.log('--- SESSION START: Block Node Discovery & Lake Retrieval (HIP-1081/1137) ---\n')
  const { network } = getClient()

  try {
    // 1. Live Consensus Address Book + HIP-1137 Block Node Discovery
    console.log('[PROCESS] Querying live Hedera Address Book (/api/v1/network/nodes)...')
    const liveNodes = await queryLiveNetworkNodes(network, 3)
    console.log(`[SUCCESS] Retrieved ${liveNodes.length} live consensus node descriptors from Mirror Node.`)

    console.log('\n[PROCESS] [ARCHITECTURAL SIMULATION] Mapping HIP-1137 Block Node gRPC descriptors...')
    const discoveredNodes = discoverBlockNodes(network, liveNodes)

    console.log(`[SUCCESS] Discovered ${discoveredNodes.length} active Block Lake Nodes:`)
    for (const node of discoveredNodes) {
      console.log(`[LOG] Node ID:  ${node.nodeId.padEnd(22)} | Validator: ${node.consensusNodeAccountId.padEnd(8)} | Endpoint: ${node.endpoint.padEnd(44)} | Ping: ${node.latencyMs}ms`)
    }

    // Select the lowest-latency healthy node
    const optimalNode = [...discoveredNodes].sort((a, b) => a.latencyMs - b.latencyMs)[0]
    console.log(`\n[INFO] Selected optimal storage peer: ${optimalNode.nodeId} (${optimalNode.endpoint})`)

    // 2. Ingest Live Block Stream Range
    const targetBlockCount = 3
    console.log(`\n[PROCESS] Requesting ${targetBlockCount} consecutive live blocks from Hedera Mirror Node...`)
    const blocks = await queryBlockRange(network, targetBlockCount)

    if (blocks.length < 2) {
      throw new Error('Insufficient block history returned from Block Node Lake.')
    }

    console.log(`[SUCCESS] Retrieved ${blocks.length} sequential blocks from live network:`)
    for (const b of blocks) {
      console.log(`[LOG] Block #${b.number} | Txs: ${b.count} | Hash: ${b.hash.slice(0, 24)}... | Prev: ${b.previous_hash.slice(0, 24)}...`)
    }

    // 3. Verify Cryptographic Continuity (Hash Chain Invariance)
    console.log('\n[PROCESS] Performing trustless hash-chain continuity verification...')
    // Note: Blocks are ordered desc: block[0] is latest, block[1] is prior
    for (let i = 0; i < blocks.length - 1; i++) {
      const current = blocks[i]
      const previous = blocks[i + 1]

      const isContinuous = current.previous_hash.toLowerCase() === previous.hash.toLowerCase()
      console.log(`[LOG] Block #${current.number} -> Block #${previous.number} link check: ${isContinuous ? 'VALID (MATCH)' : 'CORRUPTED'}`)

      if (!isContinuous) {
        throw new Error(`Hash chain discontinuity between #${current.number} and #${previous.number}`)
      }
    }

    console.log('[SUCCESS] Block Lake cryptographic continuity audit passed 100%!')

    // Persist state
    updateState('BLOCK_NODE_OPTIMAL_ID', optimalNode.nodeId)
    updateState('BLOCK_NODE_ENDPOINT', optimalNode.endpoint)
    updateState('BLOCK_LAKE_RANGE_START', blocks[blocks.length - 1].number)
    updateState('BLOCK_LAKE_RANGE_END', blocks[0].number)

    console.log('\n KEY CONCEPT:')
    console.log('Decoupling execution from long-term storage is the architectural foundation')
    console.log('of Hedera 2.0. Block Nodes (HIP-1081) allow indexers, audit tools, and light')
    console.log('clients to stream petabytes of history without degrading consensus performance.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('By querying dynamically discovered storage endpoints and verifying hash-chain')
    console.log('continuity locally, dApps remain resilient against single-RPC outages or tampering.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[ERROR] Block Node Lake Retrieval Failure:', error.message)
    process.exit(1)
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
