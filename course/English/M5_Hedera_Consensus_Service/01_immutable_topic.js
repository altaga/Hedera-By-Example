/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Immutable HCS Primitives
 * [ CONCEPT ] Decentralized Message Queues (Topics)
 * ============================================================================
 * [ KEY CONCEPT ]
 * Trust but Verify: By creating an "Immutable" topic (no keys), you ensure
 * that no one can ever delete or change the topic's settings. It becomes
 * a permanent piece of public infrastructure. HCS provides a "Global Kafka"
 * but with the added layer of trust provided by network consensus.
 * *
 * [ LEARNABLE MOMENT ]
 * HCS topics created without an adminKey or submitKey become completely immutable public data broadcast channels. Anyone can audit historical message sequence numbers with cryptographically proven consensus timestamps.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/core-concepts/consensus-service
 *
 * [ LEARNING PATH ]
 * - Previous: M4 Lab 05: Parallel Transfers
 * - Next:     M5 Lab 02: HCS Data Standards
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 01_immutable_topic.js
 * ============================================================================
 */

import { TopicCreateTransaction } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Immutable HCS Primitives ---\n')

  const { client } = getClient()

  try {
    console.log('[⚙️ PROCESS] Executing Topic Creation on Hedera Consensus Service...')

    // We create a strictly open Topic (No keys) so anyone can publish test messages
    // In production, you would use .setSubmitKey() to restrict access.
    const transaction = await new TopicCreateTransaction()
      .setTopicMemo('Hedera Syllabus HCS Topic')
      .freezeWith(client)

    const response = await transaction.execute(client)

    console.log(`[📊 LOG] View on HashScan: ${getHashscanUrl(response)}`)

    const receipt = await response.getReceipt(client)
    const topicId = receipt.topicId.toString()

    console.log(`\n[✅ SUCCESS] HCS Topic Created Successfully: ${topicId}`)

    // Automatically sync the Topic ID to the local state
    console.log('[ℹ️ INFO] Synchronizing state.json with new Topic ID...')
    updateState('HCS_TOPIC_ID', topicId)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Trust but Verify: By creating an "Immutable" topic (no keys), you')
    console.log("ensure that no one can ever delete or change the topic's settings. It")
    console.log('becomes a permanent piece of public infrastructure.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Topic Creation Failed:', error.message)
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
