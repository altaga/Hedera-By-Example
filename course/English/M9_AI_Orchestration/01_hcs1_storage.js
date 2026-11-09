/**
 * ============================================================================
 * Lab 01: Large Payload Anchoring (HCS Chunking)
 * [CONCEPT] Decentralized Data Anchoring
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Immutable Rulebook: Traditional HCS messages are limited to 1,024 bytes.
 * The SDK splits a larger payload into sequential chunks (HIP-10 chunking),
 * and the SDK subscription reassembles them. (HCS-1 is a separate file-inscription
 * standard; see M6 Labs 04-08.) Before an Anti-Cheat AI can judge a $1M tournament, it must
 * lock its exact rules on the ledger to prove undeniable fairness. In this lab,
 * we anchor a large AI Policy JSON to the ledger, proving that anyone can
 * verify the rules after the fact.
 *
 *
 * [ LEARNABLE MOMENT ]
 * AI agents require immutable memory. By inscribing large prompt templates and knowledge baselines onto HCS topics that only they can write to (submit key), agents can prove which rules they followed and when they were published.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ LEARNING PATH ]
 * - Previous: M8 Lab 11: Solidity Autonomous HSS Cron Precompile (0x16b)
 * - Next:     M9 Lab 02: HCS-2 Topic Registries
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M9_AI_Orchestration/01_hcs1_storage.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

// ─── Config ───────────────────────────────────────────────────────────────────
const AI_POLICY_PAYLOAD = JSON.stringify({
  schema: 'esports-anticheat-policy',
  version: '2.0.0',
  type: 'ESPORTS_ANTI_CHEAT_POLICY',
  description: 'Official Anti-Cheat Parameters for $1M Grand Finals',
  rules: Array.from({ length: 60 }, (_, i) => ({
    ruleId: `CHEAT_DETECT_${String(i + 1).padStart(3, '0')}`,
    action: i % 5 === 0 ? 'INSTANT_PERMA_BAN' : 'FLAG_FOR_MANUAL_REVIEW',
    snapTargetMsThreshold: 10 + (i * 7) % 50,
    wallTrackSecondsThreshold: ((i * 37) % 500 / 100).toFixed(2),
    confidenceRequired: 0.99
  }))
})

// ─── Main ──────────────────────────────────────────────────────────────────────
const main = async () => {
  console.log('--- SESSION START: Large Payload Anchoring (HCS chunking) ---\n')
  const { client, network } = getClient()

  try {
    // 1. Create a dedicated policy archive topic
    console.log(`[PROCESS] Creating a policy archive topic (submit key: only you can write) on ${network}...`)
    const createTx = await new TopicCreateTransaction()
      .setTopicMemo('esports_anticheat_v2')
      .setSubmitKey(client.operatorPublicKey) // Only you can write!
      .freezeWith(client)

    const createResponse = await createTx.execute(client)
    const createReceipt = await createResponse.getReceipt(client)
    const topicId = createReceipt.topicId.toString()

    console.log(`\n[SUCCESS] Policy Topic Created: ${topicId}`)
    console.log(`[LOG] View on HashScan: ${getHashscanUrl(createResponse)}`)

    console.log('[INFO] Synchronizing state.json with the Policy Topic...')
    updateState('HCS1_TOPIC_ID', topicId)

    // 2. Submit the massive Anti-Cheat Policy
    console.log(`\n[PROCESS] Submitting Anti-Cheat Policy (${Buffer.byteLength(AI_POLICY_PAYLOAD)} bytes)...`)
    console.log('[INFO] The SDK is splitting the payload into HCS chunks (HIP-10)...')

    const submitTx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(AI_POLICY_PAYLOAD)
      .setMaxChunks(20)
      .freezeWith(client)

    const submitResponse = await submitTx.execute(client)
    const submitReceipt = await submitResponse.getReceipt(client)

    console.log(`\n[SUCCESS] Payload anchored! Status: ${submitReceipt.status.toString()}`)
    console.log(`[LOG] Final HashScan: ${getHashscanUrl(submitResponse)}`)

    console.log('\n KEY CONCEPT:')
    console.log('The rules are now locked on the ledger. If a pro player gets banned,')
    console.log('you can publicly share the Topic ID to prove which rules were published,')
    console.log('and when, before the match started. (Whether the AI followed them is a')
    console.log('separate check.)')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Policy Anchoring Failed:', error.message)
    process.exitCode = 1
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

export { AI_POLICY_PAYLOAD }
