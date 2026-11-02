/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * LAB 02: Core Data Standards (HCS-2)
 * [ CONCEPT ] Decentralized Data Discoverability
 * ============================================================================
 * [ KEY CONCEPT ]
 * Standardization = Liquidity: Data that follows a standard is more valuable.
 * By using HCS-2, you ensure that other developers can build on top of your
 * data stream without needing a private API key from you. It transforms
 * "Data Noise" into "Interoperable Infrastructure" using a standardized
 * JSON schema header.
 * *
 * [ LEARNABLE MOMENT ]
 * Standardizing JSON payloads on HCS topics allows multi-party off-chain systems (ERP connectors, AI agents, supply chains) to interoperate seamlessly using deterministic message schemas.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 *
 * [ LEARNING PATH ]
 * - Previous: M5 Lab 01: Immutable Topic
 * - Next:     M5 Lab 03: Chunking & Subscriptions
 *
 * [ HOW TO RUN ]
 * node 02_hcs_data_standards.js
 * ============================================================================
 */

import { TopicMessageSubmitTransaction, TopicId } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'

/**
 * Ensures HCS-2 Discovery Schema compliance
 */
const buildHcs2DiscoveryMessage = (registryName, topicIdPointer, description) => {
  const payload = {
    h: 'hcs-2', // Header definition
    t: 'registry', // Message Type
    r: registryName,
    tid: topicIdPointer, // The reference to the core topic
    d: description
  }
  return JSON.stringify(payload)
}

const main = async () => {
  console.log('--- SESSION START: HCS Data Standards (Submission) ---\n')

  const { client } = getClient()
  const topicId = getState('HCS_TOPIC_ID')

  if (!topicId) {
    console.error('[❌ FAILED] Missing HCS_TOPIC_ID in configuration.')
    process.exitCode = 1
    console.log('[ℹ️ INFO] Tip: Run Lab 01 first to generate and sync a Topic ID.')
    return
  }

  try {
    console.log(`[ℹ️ INFO] Preparing HCS-2 compliant message for Topic: ${topicId}`)

    const message = buildHcs2DiscoveryMessage(
      'Hedera Syllabus Registry',
      topicId,
      'A decentralized directory of verified syllabus components.'
    )

    console.log(`[⚙️ PROCESS] Submitting Standardized Message: ${message}`)

    const transaction = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message)
      .freezeWith(client)

    const response = await transaction.execute(client)
    const receipt = await response.getReceipt(client)

    console.log('\n[✅ SUCCESS] Message Submitted successfully.')
    console.log(`[📊 LOG] Consensus Status: ${receipt.status.toString()}`)
    console.log(`[📊 LOG] View on HashScan: ${getHashscanUrl(response)}`)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Standardization = Liquidity: Data that follows a standard is more')
    console.log('valuable. By using HCS-2, you ensure that other developers can build')
    console.log('on top of your data stream without needing a private API key from you.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] HCS Submission Failed:', error.message)
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

export { buildHcs2DiscoveryMessage }
