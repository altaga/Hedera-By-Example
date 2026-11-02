/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: HCS-1 Static File Storage (Heavy Payloads)
 * [ CONCEPT ] Decentralized Data Anchoring
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Immutable Rulebook: Traditional HCS messages are limited to 1,024 bytes.
 * HCS-1 is a standard that auto-chunks large payloads into sequential
 * messages. Before an Anti-Cheat AI can judge a $1M tournament, it must
 * lock its exact rules on the ledger to prove undeniable fairness. In this lab,
 * we anchor a large AI Policy JSON to the ledger, proving that anyone can
 * verify the rules after the fact.
 * *
 * [ LEARNABLE MOMENT ]
 * AI agents require immutable memory. By inscribing large prompt templates and knowledge baselines onto HCS-1 topics, agents verify cognitive provenance and resist prompt tampering attacks.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hashgraphonline.com/standards/hcs-1/
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 09: Zero-Knowledge Privacy Pool
 * - Next:     M9 Lab 02: HCS-2 Registries
 *
 * [ HOW TO RUN ]
 * node 01_hcs1_storage.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

// ─── Config ───────────────────────────────────────────────────────────────────
const AI_POLICY_PAYLOAD = JSON.stringify({
  schema: 'HCS-1',
  version: '2.0.0',
  type: 'ESPORTS_ANTI_CHEAT_POLICY',
  description: 'Official Anti-Cheat Parameters for $1M Grand Finals',
  rules: Array.from({ length: 60 }, (_, i) => ({
    ruleId: `CHEAT_DETECT_${String(i + 1).padStart(3, '0')}`,
    action: i % 5 === 0 ? 'INSTANT_PERMA_BAN' : 'FLAG_FOR_MANUAL_REVIEW',
    snapTargetMsThreshold: Math.floor(Math.random() * 50) + 10,
    wallTrackSecondsThreshold: (Math.random() * 5).toFixed(2),
    confidenceRequired: 0.99
  }))
})

// ─── Main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- SESSION START: HCS-1 Large Payload Anchoring ---\n')
  const { client, network } = getClient()

  try {
    // 1. Create a dedicated HCS-1 archive topic
    console.log(`[⚙️ PROCESS] Creating secure HCS-1 archive topic on ${network}...`)
    const createTx = await new TopicCreateTransaction()
      .setTopicMemo('hcs-1:esports_anticheat_v2')
      .setSubmitKey(client.operatorPublicKey) // Only you can write!
      .freezeWith(client)

    const createResponse = await createTx.execute(client)
    const createReceipt = await createResponse.getReceipt(client)
    const topicId = createReceipt.topicId.toString()

    console.log(`\n[✅ SUCCESS] HCS-1 Root Topic Created: ${topicId}`)
    console.log(`[📊 LOG] View on HashScan: ${getHashscanUrl(createResponse)}`)

    console.log('[ℹ️ INFO] Synchronizing state.json with HCS-1 Policy Topic...')
    updateState('HCS1_TOPIC_ID', topicId)

    // 2. Submit the massive Anti-Cheat Policy
    console.log(`\n[⚙️ PROCESS] Submitting Anti-Cheat Policy (${Buffer.byteLength(AI_POLICY_PAYLOAD)} bytes)...`)
    console.log('[ℹ️ INFO] The SDK is auto-chunking the payload into HCS-1 shards...')

    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(AI_POLICY_PAYLOAD)
      .setMaxChunks(20)
      .freezeWith(client)

    const submitResponse = await submitTx.execute(client)
    const submitReceipt = await submitResponse.getReceipt(client)

    console.log(`\n[✅ SUCCESS] Payload anchored! Status: ${submitReceipt.status.toString()}`)
    console.log(`[📊 LOG] Final HashScan: ${getHashscanUrl(submitResponse)}`)

    console.log('\n💡 KEY CONCEPT:')
    console.log('The rules are now locked on the ledger. If a pro player gets banned,')
    console.log('you can publicly share the Topic ID to prove the AI acted fairly based')
    console.log('on immutable rules established before the match even started.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] HCS-1 Lifecycle Failed:', error.message)
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

export { AI_POLICY_PAYLOAD }
