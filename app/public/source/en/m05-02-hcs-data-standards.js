/**
 * ============================================================================
 * Lab 02: Core Data Standards (HCS-2)
 * [CONCEPT] Decentralized Data Discoverability
 * ============================================================================
 * [ KEY CONCEPT ]
 * Standardization = Liquidity: Data that follows a standard is more valuable.
 * By using HCS-2, you ensure that other developers can build on top of your
 * data stream without needing a private API key from you. It transforms
 * "Data Noise" into "Interoperable Infrastructure" using a standardized
 * JSON schema header.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Standardizing JSON payloads on HCS topics allows multi-party off-chain systems (ERP connectors, AI agents, supply chains) to interoperate seamlessly using deterministic message schemas.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message
 * - https://hol.org/docs/standards/hcs-2/
 *
 * [ LEARNING PATH ]
 * - Previous: M5 Lab 01: Immutable HCS Primitives
 * - Next:     M5 Lab 03: Automatic Chunking and Subscriptions (gRPC)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M5 Lab 01 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M5_Hedera_Consensus_Service/02_hcs_data_standards.js
 * ============================================================================
 */

import { TopicMessageSubmitTransaction, TopicId } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'

/**
 * Builds an HCS-2 "register" message: { p, op, t_id, m }.
 * Spec: https://hol.org/docs/standards/hcs-2/
 */
const buildHcs2DiscoveryMessage = (registryName, topicIdPointer, description) => {
  const payload = {
    p: 'hcs-2', // protocol
    op: 'register', // operation
    t_id: topicIdPointer, // the topic this registry entry points to
    m: `${registryName}: ${description}`.slice(0, 500) // memo (HCS-2 allows up to 500 characters)
  }
  return JSON.stringify(payload)
}

const main = async () => {
  console.log('--- SESSION START: HCS Data Standards (Submission) ---\n')

  const { client } = getClient()
  const topicId = getState('HCS_TOPIC_ID')

  if (!topicId) {
    console.error('[FAILED] Missing HCS_TOPIC_ID in state. Run M5 Lab 01 first.')
    process.exitCode = 1
    console.log('[INFO] Tip: Run Lab 01 first to generate and sync a Topic ID.')
    return
  }

  try {
    console.log(`[INFO] Preparing an HCS-2 register message for Topic: ${topicId}`)
    console.log('[INFO] Only the message follows HCS-2: a full registry topic also carries an "hcs-2:<type>:<ttl>" memo, and this one is the Lab 01 topic.')

    const message = buildHcs2DiscoveryMessage(
      'Hedera Syllabus Registry',
      topicId,
      'A decentralized directory of verified syllabus components.'
    )

    console.log(`[PROCESS] Submitting Standardized Message: ${message}`)

    // Publish: consensus gives the message a sequence number and a timestamp everyone agrees on.
    const transaction = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicId))
      .setMessage(message)
      .freezeWith(client)

    const response = await transaction.execute(client)
    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const receipt = await response.getReceipt(client)

    console.log('\n[SUCCESS] Message Submitted successfully.')
    console.log(`[LOG] Consensus Status: ${receipt.status.toString()}`)
    console.log(`[LOG] View on HashScan: ${getHashscanUrl(response)}`)

    console.log('\n KEY CONCEPT:')
    console.log('Standardization = Liquidity: Data that follows a standard is more')
    console.log('valuable. By using HCS-2, you ensure that other developers can build')
    console.log('on top of your data stream without needing a private API key from you.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] HCS Submission Failed:', error.message)
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

export { buildHcs2DiscoveryMessage }
