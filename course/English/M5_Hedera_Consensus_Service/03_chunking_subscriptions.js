/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: Automatic Chunking and Subscriptions (gRPC)
 * [CONCEPT] Real-Time Decentralized Streaming
 * ============================================================================
 * [ KEY CONCEPT ]
 * Listening vs. Polling: Instead of hammering an API for updates, you use a
 * gRPC "Subscription". This is a persistent connection that "pushes" new
 * messages to your application the millisecond they reach consensus.
 * Furthermore, Hedera supports "Chunking" (HIP-10), allowing you to push
 * large payloads (documents, images, large JSON) that the SDK and Mirror
 * Node reassemble automatically.
 * *
 * [ LEARNABLE MOMENT ]
 * When payloads exceed the single-message consensus limit (1024 bytes), the SDK automatically splits data into sequenced chunks. Subscribing clients reconstruct the full message using the transaction validStart timestamp.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message#chunk-a-message
 *
 * [ LEARNING PATH ]
 * - Previous: M5 Lab 02: HCS Data Standards
 * - Next:     M5 Lab 04: HCS Ping-Pong
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M5 Lab 01 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 03_chunking_subscriptions.js
 * ============================================================================
 */

import {
  TopicMessageQuery,
  TopicMessageSubmitTransaction
} from '@hiero-ledger/sdk'
import { getClient, getState, exitIfStuck } from '../M99_Utilities/index.js'

/**
 * Publisher: Automatically splits large messages underneath the hood.
 */
const publishLargePayload = async (client, topicId, message) => {
  console.log(`[PROCESS] Publishing large message... (${message.length} bytes)`)

  // The SDK handles chunking automatically if the message exceeds 6KB
  const transaction = new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(message)
    .freezeWith(client)

  const response = await transaction.execute(client)
  const receipt = await response.getReceipt(client)

  return receipt.status.toString()
}

/**
 * Subscriber: Uses gRPC to listen dynamically for incoming messages.
 */
const subscribeToTopic = (client, topicId) => {
  console.log(`[INFO] gRPC: Subscribing to Topic ${topicId}...`)
  console.log('[INFO] Listening for live messages... (Press Ctrl+C to stop manually)\n')

  return new TopicMessageQuery()
    .setTopicId(topicId)
    .setStartTime(0) // 0 = Get ALL historical messages first, then listen live
    .subscribe(
      client,
      (error) => { console.error('[FAILED] Subscription Error:', error); process.exit(1) },
      (message) => {
        const payload = Buffer.from(message.contents).toString()
        const timestamp = message.consensusTimestamp.toDate().toLocaleTimeString()

        console.log(`--- [EVENT] New Message Received [${timestamp}] ---`)
        console.log(`└─ Sequence: ${message.sequenceNumber.toString()}`)
        console.log(`└─ Chunks:   ${message.chunks ? message.chunks.length : 1}`)
        console.log(`└─ Payload:  ${payload.substring(0, 80)}${payload.length > 80 ? '...' : ''}`)
        console.log('---------------------------------------------------\n')
      }
    )
}

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'subscription messages')
  console.log('--- SESSION START: HCS Chunking & Subscriptions ---\n')

  const { client } = getClient()
  const topicId = getState('HCS_TOPIC_ID')

  if (!topicId) {
    console.error('[FAILED] Missing HCS_TOPIC_ID in configuration.')
    process.exitCode = 1
    return
  }

  try {
    // 1. Start the real-time subscription
    subscribeToTopic(client, topicId)

    // 2. Wait a moment then publish a message
    console.log('[INFO] Waiting for gRPC mesh stabilization...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    const largeMessage = 'HCS Chunking Test Payload. ' + 'Scalable data... '.repeat(350) // ~7KB+
    const status = await publishLargePayload(client, topicId, largeMessage)

    console.log(`[SUCCESS] Large Message Submission Status: ${status}`)

    // Note: The script will stay running because of the active gRPC subscription.
    // We close the client after a 10s timeout for this automated demonstration.
    setTimeout(() => {
      console.log('\n[INFO] Closing subscription and exiting demo.')
      client.close()
      console.log('\n--- SESSION COMPLETE ---')
      process.exit()
    }, 10000)

    console.log('\n KEY CONCEPT:')
    console.log('Listening vs. Polling: Instead of hammering an API for updates, you')
    console.log('use a gRPC "Subscription". This is a persistent connection that')
    console.log('"pushes" new messages to your application the millisecond they reach')
    console.log('consensus.')
  } catch (error) {
    console.error('\n[FAILED] HCS Operation Failed:', error.message)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}

export { publishLargePayload, subscribeToTopic }
