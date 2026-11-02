/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 07: Botanical Agent Swarms (HCS-15 Petals, HCS-18 Discovery, HCS-16 Flora & HCS-17 State Hash)
 * [ CONCEPT ] Multi-Account Key Isolation & Threshold Swarm Coordination (AppNets)
 * ============================================================================
 * [ KEY CONCEPT ]
 * Hashgraph Online (hol.org) defines the "Botanical Suite" (HCS-15 through HCS-18)
 * for self-organizing autonomous AI agent collectives ("Floras"):
 * 1. HCS-15 (Petal Accounts): Agents spawn multiple isolated sub-accounts ("Petals")
 *    that share a single master ECDSA private key—isolating financial risk per task
 *    without managing dozens of seed phrases.
 * 2. HCS-18 (Flora Discovery): Autonomous Petals discover each other on a public
 *    broadcast topic (`announce` ➔ `propose` ➔ `respond`) without a central server.
 * 3. HCS-16 (Flora Coordination): Petals unite into a multi-signature "Flora"
 *    AppNet account governed by a Threshold KeyList and a Topic Triad
 *    (Communication, Transaction, and State topics).
 * 4. HCS-17 (State Hash): The Flora anchors deterministic SHA-384/SHA-256 state
 *    hashes so every member verifies swarm synchronization.
 *
 * [ LEARNABLE MOMENT ]
 * Never give an autonomous AI swarm a single shared private key—if one node is
 * compromised, the entire treasury is drained. By combining HCS-15 Petals with an
 * HCS-16 Threshold KeyList (`2-of-2`), the swarm achieves fault-tolerant collective
 * custody verified by HCS-17 state hashes.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-15/
 * - https://hol.org/docs/standards/hcs-16/
 * - https://hol.org/docs/standards/hcs-17/
 * - https://hol.org/docs/standards/hcs-18/
 *
 * [ LEARNING PATH ]
 * - Previous: M14 Lab 06: Encrypted AI Agent Swarm Chat
 * - Next:     M14 Lab 08: HCS-12 HashLinks & HCS-21 Adapter Registry
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~5 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M14_Advanced_HCS_Standards_AI/07_hcs15_to_18_petal_flora_swarm.js
 * ============================================================================
 */

import crypto from 'crypto'
import {
  KeyList,
  PrivateKey
} from '@hiero-ledger/sdk'
import {
  FloraTopicType,
  buildHcs15PetalAccountCreateTx,
  buildHcs16CreateAccountTx,
  buildHcs16CreateFloraTopicTx,
  buildHcs16FloraCreatedTx,
  buildHcs17MessageTx,
  buildHcs18AnnounceMessage,
  buildHcs18CreateDiscoveryTopicTx,
  buildHcs18ProposeMessage,
  buildHcs18RespondMessage,
  buildHcs18SubmitDiscoveryMessageTx
} from '@hashgraphonline/standards-sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HOL Botanical Agent Swarm (HCS-15 + HCS-18 + HCS-16 + HCS-17) ---\n')
  const { client, operatorId } = getClient()

  try {
    // 1. HCS-15: Create Two Isolated "Petal" Agent Accounts (`hcs-15:op:petal_account_create`)
    console.log('[⚙️ PROCESS] Step 1 [HCS-15]: Spawning Isolated Petal Sub-Accounts...')
    const masterKeyA = PrivateKey.generateECDSA()
    const masterKeyB = PrivateKey.generateECDSA()

    const petalATx = buildHcs15PetalAccountCreateTx({
      publicKey: masterKeyA.publicKey,
      initialBalance: 0.5,
      maxAutomaticTokenAssociations: 5,
      accountMemo: 'HCS-15:PETAL:ALPHA_QUANT'
    })
    const petalAId = (await (await petalATx.execute(client)).getReceipt(client)).accountId.toString()

    const petalBTx = buildHcs15PetalAccountCreateTx({
      publicKey: masterKeyB.publicKey,
      initialBalance: 0.5,
      maxAutomaticTokenAssociations: 5,
      accountMemo: 'HCS-15:PETAL:BETA_SENTINEL'
    })
    const petalBId = (await (await petalBTx.execute(client)).getReceipt(client)).accountId.toString()

    console.log(`[🌸 HCS-15] Petal Alpha Created: ${petalAId} (Memo: HCS-15:PETAL:ALPHA_QUANT)`)
    console.log(`[🌸 HCS-15] Petal Beta Created:  ${petalBId} (Memo: HCS-15:PETAL:BETA_SENTINEL)`)

    // 2. HCS-18: Permissionless Flora Discovery Protocol (`announce` ➔ `propose` ➔ `respond`)
    console.log('\n[⚙️ PROCESS] Step 2 [HCS-18]: Launching Flora Discovery Topic & Handshake...')
    const discoveryTopicTx = buildHcs18CreateDiscoveryTopicTx({ ttlSeconds: 86400 })
      .setAutoRenewAccountId(operatorId.toString())
    const discoveryTopicId = (await (await discoveryTopicTx.execute(client)).getReceipt(client)).topicId.toString()
    console.log(`[📡 HCS-18] Discovery Topic Active: ${discoveryTopicId}`)

    const announceMsg = buildHcs18AnnounceMessage({
      account: petalAId,
      petal: { name: 'AlphaQuant-Petal', priority: 100 },
      capabilities: { protocols: [15, 16, 17, 18] },
      valid_for: 3600
    })
    await (await buildHcs18SubmitDiscoveryMessageTx({
      topicId: discoveryTopicId,
      message: announceMsg
    }).execute(client)).getReceipt(client)

    const proposeMsg = buildHcs18ProposeMessage({
      proposer: petalAId,
      members: [
        { account: petalAId, priority: 100 },
        { account: petalBId, priority: 90 }
      ],
      config: {
        name: 'Aegis DeFi Arbitrage Flora',
        threshold: 2,
        purpose: 'Autonomous multi-sig liquidity rebalancing'
      }
    })
    await (await buildHcs18SubmitDiscoveryMessageTx({
      topicId: discoveryTopicId,
      message: proposeMsg
    }).execute(client)).getReceipt(client)

    const respondMsg = buildHcs18RespondMessage({
      responder: petalBId,
      proposal_seq: 2,
      decision: 'accept'
    })
    await (await buildHcs18SubmitDiscoveryMessageTx({
      topicId: discoveryTopicId,
      message: respondMsg
    }).execute(client)).getReceipt(client)
    console.log('[✅ HCS-18] Discovery Complete: Announce (#1) ➔ Propose (#2) ➔ Accept (#3)!')

    // 3. HCS-16: Assemble Multi-Sig "Flora" Account & Topic Triad (Communication, Transaction, State)
    console.log('\n[⚙️ PROCESS] Step 3 [HCS-16]: Forming 2-of-2 Multi-Sig Flora Account & Topic Triad...')
    const floraKeyList = new KeyList([masterKeyA.publicKey, masterKeyB.publicKey], 2)
    const floraAccountTx = buildHcs16CreateAccountTx({
      keyList: floraKeyList,
      initialBalanceHbar: 1,
      maxAutomaticTokenAssociations: 5
    })
    const floraAccountId = (await (await floraAccountTx.execute(client)).getReceipt(client)).accountId.toString()

    const commTopicId = (await (await buildHcs16CreateFloraTopicTx({
      floraAccountId,
      topicType: FloraTopicType.COMMUNICATION,
      autoRenewAccountId: operatorId.toString()
    }).execute(client)).getReceipt(client)).topicId.toString()

    const txTopicId = (await (await buildHcs16CreateFloraTopicTx({
      floraAccountId,
      topicType: FloraTopicType.TRANSACTION,
      autoRenewAccountId: operatorId.toString()
    }).execute(client)).getReceipt(client)).topicId.toString()

    const stateTopicId = (await (await buildHcs16CreateFloraTopicTx({
      floraAccountId,
      topicType: FloraTopicType.STATE,
      autoRenewAccountId: operatorId.toString()
    }).execute(client)).getReceipt(client)).topicId.toString()

    const floraCreatedTx = buildHcs16FloraCreatedTx({
      topicId: commTopicId,
      operatorId: floraAccountId,
      floraAccountId,
      topics: {
        communication: commTopicId,
        transaction: txTopicId,
        state: stateTopicId
      }
    })
    await (await floraCreatedTx.execute(client)).getReceipt(client)
    console.log(`[🌿 HCS-16] Multi-Sig Flora Account: ${floraAccountId} (2-of-2 Threshold)`)
    console.log(`[📊 TRIAD]  Comm: ${commTopicId} | Tx: ${txTopicId} | State: ${stateTopicId}`)

    // 4. HCS-17: Calculate & Anchor Tamper-Proof Swarm State Hash
    console.log('\n[⚙️ PROCESS] Step 4 [HCS-17]: Computing & Anchoring Deterministic Swarm State Hash...')
    const canonicalSwarmState = JSON.stringify({
      floraAccountId,
      members: [petalAId, petalBId],
      topics: [commTopicId, txTopicId, stateTopicId],
      epoch: 1
    })
    const stateHash = crypto.createHash('sha384').update(canonicalSwarmState).digest('hex')

    const hcs17Tx = buildHcs17MessageTx({
      topicId: stateTopicId,
      stateHash,
      accountId: floraAccountId,
      topics: [commTopicId, txTopicId],
      epoch: 1,
      memo: 'Epoch 1 Genesis Flora Synchronization Verified'
    })
    const hcs17Receipt = await (await hcs17Tx.execute(client)).getReceipt(client)
    console.log(`[🔐 HCS-17] State Hash Anchored at Sequence #${hcs17Receipt.topicSequenceNumber}!`)
    console.log(`[📊 HASH]   sha384:${stateHash.slice(0, 48)}...`)

    updateState('HCS15_PETAL_ALPHA_ID', petalAId)
    updateState('HCS15_PETAL_BETA_ID', petalBId)
    updateState('HCS16_FLORA_ACCOUNT_ID', floraAccountId)
    updateState('HCS17_FLORA_STATE_HASH', stateHash)
    updateState('HCS18_DISCOVERY_TOPIC_ID', discoveryTopicId)

    console.log('\n💡 KEY CONCEPT:')
    console.log('The HOL Botanical Suite (HCS-15/16/17/18) turns independent AI agents into')
    console.log('self-organizing multi-signature collectives (Floras) with isolated Petal accounts,')
    console.log('permissionless peer discovery, and cryptographic state synchronization.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('By separating communication (`COMMUNICATION`), transaction scheduling (`TRANSACTION`),')
    console.log('and state checkpoints (`STATE`) into an HCS-16 Triad, agent swarms scale without')
    console.log('clogging their consensus state verification feed with chat chatter.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] Botanical Swarm Execution Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
