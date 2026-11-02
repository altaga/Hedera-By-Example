/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 02: HCS-2 Topic Registries
 * [ CONCEPT ] Decentralized Service Discovery (Yellow Pages)
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Public Index: HCS-2 defines a JSON schema that turns an HCS topic into
 * a machine-readable directory. Wallets and explorers use this to surface
 * agent endpoints automatically. Instead of forcing players to guess where
 * your Anti-Cheat rules are, you register your Agent Topic in this "Yellow
 * Pages" registry, making your services globally discoverable and verifiable
 * without central APIs.
 * *
 * [ LEARNABLE MOMENT ]
 * HCS-2 registries allow AI agents to publish and discover topic schemas on-chain, eliminating the need for centralized service registries or vulnerable third-party web directories.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-2/
 *
 * [ LEARNING PATH ]
 * - Previous: M9 Lab 01: HCS-1 Storage
 * - Next:     M9 Lab 03: HCS-2 Search
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M9 Lab 01 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 02_hcs2_registries.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState, getState } from '../M99_Utilities/index.js'

// ─── HCS-2 Schema Builder ────────────────────────────────────────────────────
const buildHcs2RegistryMessage = (registryName, topicIdPointer, category, status) => ({
  h: 'hcs-2', // Protocol header
  t: 'registry', // Message type
  r: registryName, // Registry name
  tid: topicIdPointer, // Topic ID being registered
  cat: category, // Agent category for discovery filters
  status, // 'ACTIVE', 'DEPRECATED', etc.
  ts: Date.now()
})

// ─── Main ────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- SESSION START: HCS-2 Service Discovery Registry ---\n')
  const { client, network } = getClient()

  // Grab the Lab 01 Topic ID from our local state
  const targetAgentTopicId = getState('HCS1_TOPIC_ID')

  if (!targetAgentTopicId) {
    console.error('[❌ FAILED] Missing HCS-1 Topic ID. Please run Lab 01 first.')
    process.exitCode = 1
    return
  }

  try {
    // 1. Create the Verified Esports Agent Registry topic
    console.log(`[⚙️ PROCESS] Creating "Verified Esports Registry" topic on ${network}...`)
    const registryTx = await new TopicCreateTransaction()
      .setTopicMemo('hcs-2:verified_esports_agents_v1')
      .setSubmitKey(client.operatorPublicKey)
      .freezeWith(client)

    const registryResponse = await registryTx.execute(client)
    const registryReceipt = await registryResponse.getReceipt(client)
    const registryTopicId = registryReceipt.topicId.toString()

    console.log(`\n[✅ SUCCESS] Registry Topic Created: ${registryTopicId}`)
    console.log(`[📊 LOG] View on HashScan: ${getHashscanUrl(registryResponse)}`)

    console.log('[ℹ️ INFO] Synchronizing state.json with HCS-2 Registry ID...')
    updateState('HCS2_REGISTRY_TOPIC_ID', registryTopicId)

    // 2. Submit our Lab 02 Anti-Cheat Agent into this new registry
    console.log(`\n[⚙️ PROCESS] Registering Anti-Cheat Agent (${targetAgentTopicId}) into the directory...`)
    const discoveryPayload = buildHcs2RegistryMessage(
      'Official Tournament Agent Registry',
      targetAgentTopicId,
      'ANTI_CHEAT_ORACLE',
      'ACTIVE'
    )

    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(registryTopicId)
      .setMessage(JSON.stringify(discoveryPayload))
      .freezeWith(client)

    const submitResponse = await submitTx.execute(client)
    const submitReceipt = await submitResponse.getReceipt(client)

    console.log(`\n[✅ SUCCESS] HCS-2 Entry Published! Status: ${submitReceipt.status.toString()}`)
    console.log(`[📊 LOG] View Entry on HashScan: ${getHashscanUrl(submitResponse)}`)

    console.log('\n[📊 LOG] RAW HCS-2 Payload:')
    console.log(JSON.stringify(discoveryPayload, null, 4))

    console.log('\n💡 KEY CONCEPT:')
    console.log('By registering your specific Anti-Cheat topic in a standardized HCS-2 registry,')
    console.log('third-party tournament clients, leaderboards, and auditors can automatically')
    console.log('discover and verify your game\'s rules without needing your API keys.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Registry Lifecycle Failed:', error.message)
    process.exitCode = 1
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

export { buildHcs2RegistryMessage }
