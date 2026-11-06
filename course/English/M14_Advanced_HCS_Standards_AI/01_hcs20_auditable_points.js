/**
 * ============================================================================
 * Lab 01: HCS-20 Auditable Points & Inscription Ledgers
 * [CONCEPT] High-Throughput Event-Sourced Accounting over Consensus
 * ============================================================================
 * [ KEY CONCEPT ]
 * Event-Sourced Inscription Accounting: Rather than storing user balances in
 * smart contract storage slots (which suffer from state bloat and EVM gas spikes),
 * HCS-20 publishes standardized, deterministic JSON inscription actions
 * (deploy, mint, transfer, burn) directly to an HCS topic.
 * Any indexer, client, or AI agent can replay the consensus stream to reconstruct
 * exact, tamper-proof balances with zero smart contract risk.
 *
 * [ LEARNABLE MOMENT ]
 * High-frequency point programs (loyalty points, gaming XP, agent reputation)
 * require millions of updates. Running them as HTS tokens or EVM ERC-20s can be
 * constrained by account token associations or gas costs. HCS-20 allows limitless
 * transaction throughput at $0.0001 per update.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-20/
 *
 * [ LEARNING PATH ]
 * - Previous: M13 Lab 06: Block Stream Protobuf Encoder/Parser with the Official HAPI Schemas
 * - Next:     M14 Lab 02: HCS-25 AI Trust Score Methodology
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M14_Advanced_HCS_Standards_AI/01_hcs20_auditable_points.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import {
  HCS20DeployMessageSchema,
  HCS20MintMessageSchema,
  HCS20TransferMessageSchema
} from '@hashgraphonline/standards-sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

/**
 * Builds and validates standard HCS-20 inscription messages using official
 * `@hashgraphonline/standards-sdk` Zod schemas.
 */
const HCS20 = {
  deploy: (name, tick, maxSupply) => {
    const parsed = HCS20DeployMessageSchema.parse({
      p: 'hcs-20',
      op: 'deploy',
      name,
      tick: tick.toLowerCase(),
      max: maxSupply.toString()
    })
    return parsed
  },
  mint: (tick, to, amount) => {
    const parsed = HCS20MintMessageSchema.parse({
      p: 'hcs-20',
      op: 'mint',
      tick: tick.toLowerCase(),
      to,
      amt: amount.toString()
    })
    return parsed
  },
  transfer: (tick, from, to, amount) => {
    const parsed = HCS20TransferMessageSchema.parse({
      p: 'hcs-20',
      op: 'transfer',
      tick: tick.toLowerCase(),
      from,
      to,
      amt: amount.toString()
    })
    return parsed
  }
}

/**
 * Deterministic in-memory HCS-20 indexer state engine.
 */
class HCS20StateEngine {
  constructor () {
    this.tokens = new Map()
    this.balances = new Map()
  }

  processMessage (msg, seq) {
    if (msg.p !== 'hcs-20') return false
    const tick = msg.tick.toUpperCase()

    if (msg.op === 'deploy') {
      if (this.tokens.has(tick)) return false // Tick already deployed
      this.tokens.set(tick, {
        tick,
        name: msg.name,
        max: BigInt(msg.max),
        currentSupply: 0n
      })
      return true
    }

    const token = this.tokens.get(tick)
    if (!token) return false

    if (msg.op === 'mint') {
      const amt = BigInt(msg.amt)
      if (token.currentSupply + amt > token.max) return false
      token.currentSupply += amt

      const balKey = `${tick}:${msg.to}`
      const current = this.balances.get(balKey) || 0n
      this.balances.set(balKey, current + amt)
      return true
    }

    if (msg.op === 'transfer') {
      const amt = BigInt(msg.amt)
      const fromKey = `${tick}:${msg.from}`
      const fromBal = this.balances.get(fromKey) || 0n
      if (fromBal < amt) return false // Insufficient funds

      this.balances.set(fromKey, fromBal - amt)
      const toKey = `${tick}:${msg.to}`
      const toBal = this.balances.get(toKey) || 0n
      this.balances.set(toKey, toBal + amt)
      return true
    }

    return false
  }

  getBalance (tick, accountId) {
    return (this.balances.get(`${tick.toUpperCase()}:${accountId}`) || 0n).toString()
  }
}

const main = async () => {
  console.log('--- SESSION START: HCS-20 Auditable Points & Inscriptions ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. Create dedicated HCS-20 Inscription Topic
    console.log('[PROCESS] Creating dedicated HCS-20 Inscription Ledger Topic...')
    // Create the topic: an ordered, timestamped message log; a submit key would restrict who can write.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-20:AUDITABLE:POINTS:V1')
      .execute(client)

    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const topicReceipt = await topicTx.getReceipt(client)
    const topicId = topicReceipt.topicId.toString()
    console.log(`[SUCCESS] HCS-20 Point Ledger Created: Topic ID ${topicId}`)

    const stateEngine = new HCS20StateEngine()
    const recipientAgent = '0.0.8707881'

    // 2. Inscribe Deploy Action (Validated via HCS20DeployMessageSchema)
    console.log('\n[PROCESS] Inscribing HCS-20 Token Deployment: Ticker [aipnt] (Max: 1,000,000)...')
    const deployMsg = HCS20.deploy('AI Reputation Points', 'aipnt', 1000000)
    // Publish: consensus gives the message a sequence number and a timestamp everyone agrees on.
    const deployTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(deployMsg))
      .execute(client)
    const deployReceipt = await deployTx.getReceipt(client)
    stateEngine.processMessage(deployMsg, deployReceipt.topicSequenceNumber)
    console.log(`[SUCCESS] Deployed AIPNT at Consensus Sequence #${deployReceipt.topicSequenceNumber}`)

    // 3. Inscribe Mint Action (Validated via HCS20MintMessageSchema)
    console.log(`\n[PROCESS] Inscribing Mint of 50,000 AIPNT to Operator (${operatorId})...`)
    const mintMsg = HCS20.mint('aipnt', operatorId.toString(), 50000)
    const mintTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(mintMsg))
      .execute(client)
    const mintReceipt = await mintTx.getReceipt(client)
    stateEngine.processMessage(mintMsg, mintReceipt.topicSequenceNumber)
    console.log(`[SUCCESS] Minted 50,000 AIPNT at Consensus Sequence #${mintReceipt.topicSequenceNumber}`)

    // 4. Inscribe Transfer Action (Validated via HCS20TransferMessageSchema)
    console.log(`\n[PROCESS] Inscribing Transfer of 12,500 AIPNT from Operator to Agent (${recipientAgent})...`)
    const transferMsg = HCS20.transfer('aipnt', operatorId.toString(), recipientAgent, 12500)
    const transferTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(transferMsg))
      .execute(client)
    const transferReceipt = await transferTx.getReceipt(client)
    stateEngine.processMessage(transferMsg, transferReceipt.topicSequenceNumber)
    console.log(`[SUCCESS] Transferred 12,500 AIPNT at Consensus Sequence #${transferReceipt.topicSequenceNumber}`)

    // 5. Indexer State Reconstruction & Audit
    console.log('\n[AUDIT] Reconstructed HCS-20 Ledger State:')
    console.log(`[LOG] Operator (${operatorId}) Balance:       ${stateEngine.getBalance('AIPNT', operatorId.toString())} AIPNT`)
    console.log(`[LOG] Recipient Agent (${recipientAgent}) Balance: ${stateEngine.getBalance('AIPNT', recipientAgent)} AIPNT`)

    // Persist state
    updateState('HCS20_TOPIC_ID', topicId)
    updateState('HCS20_TICK', 'AIPNT')
    updateState('HCS20_OPERATOR_BALANCE', stateEngine.getBalance('AIPNT', operatorId.toString()))
    updateState('HCS20_AGENT_BALANCE', stateEngine.getBalance('AIPNT', recipientAgent))

    console.log('\n KEY CONCEPT:')
    console.log('HCS-20 is pure event-sourcing on Hedera. Any third-party indexer reading')
    console.log(`Topic ${topicId} will arrive at the exact same mathematical balances`)
    console.log('without executing a single smart contract bytecode instruction.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('EVM storage slots are expensive; HCS consensus ordering is fractionally priced.')
    console.log('Separating immutable data sequencing from off-chain indexing scales to millions of users.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] HCS-20 Execution Failure:', error.message)
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
