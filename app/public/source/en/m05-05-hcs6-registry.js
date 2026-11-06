/**
 * ============================================================================
 * Lab 05: HCS-6 Decentralized Registry
 * [CONCEPT] On-Chain Service Discovery
 * ============================================================================
 * [ KEY CONCEPT ]
 * HCS-6 is a community standard for creating decentralized registries on top of
 * the Hedera Consensus Service. Instead of relying on a centralized database
 * (like the Apple App Store or Google Play), developers can publish their dApp's
 * metadata, website, and smart contract addresses to a public HCS topic.
 * Any client can listen to this topic to discover new services dynamically.
 * *
 * [ LEARNABLE MOMENT ]
 * HCS-6 defines a standardized schema for decentralized registries over consensus. By anchoring key-value configurations to HCS, distributed applications achieve tamper-proof registry lookups without centralized databases.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-6/
 *
 * [ LEARNING PATH ]
 * - Previous: M5 Lab 04: HCS Precision Benchmarking (Latency Teardown)
 * - Next:     M5 Lab 06: Revenue-Generating Paid Topics & Tokenized Data Streams (HIP-991)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M5_Hedera_Consensus_Service/05_hcs6_registry.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicMessageQuery
} from '@hiero-ledger/sdk'
import { getClient, exitIfStuck } from '../M99_Utilities/index.js'

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'subscription messages')
  console.log('--- SESSION START: HCS-6 Registry ---\n')

  const { client } = getClient()

  try {
    // 1. Create a Topic to act as our decentralized Registry
    console.log('[PROCESS] Creating an HCS Topic for the Registry...')
    let tx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-6 Global App Registry')
      .execute(client)

    let receipt = await tx.getReceipt(client)
    const topicId = receipt.topicId
    console.log(`[SUCCESS] Registry Topic created: ${topicId.toString()}`)

    // 2. Define the HCS-6 Compliant Payload
    // The HCS-6 standard dictates a specific JSON structure to register a service.
    const hcs6Payload = {
      p: 'hcs-6',
      op: 'register',
      name: 'Hedera For Dummies dApp',
      description: 'The premier educational platform for Hedera developers.',
      tags: ['education', 'web3', 'hiero'],
      url: 'https://hedera.com',
      metadata: {
        version: '1.0.0',
        author: 'VAI'
      }
    }

    console.log('\n[PROCESS] Submitting HCS-6 Registration Payload...')
    console.log(JSON.stringify(hcs6Payload, null, 2))

    tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify(hcs6Payload))
      .execute(client)

    receipt = await tx.getReceipt(client)
    console.log(`[SUCCESS] App registered on-chain! Sequence Number: ${receipt.topicSequenceNumber.toString()}`)

    // 3. Subscribe to the Registry to discover apps
    console.log('\n[PROCESS] Subscribing to the Registry to discover new services...')

    // We use a Promise to wait for the message to propagate through the mirror node
    await new Promise((resolve) => {
      new TopicMessageQuery()
        .setTopicId(topicId)
        .setStartTime(0)
        .subscribe(
          client,
          (error) => { console.error('[FAILED] Subscription Error:', error); process.exit(1) },
          (message) => {
            const content = Buffer.from(message.contents).toString('utf8')
            try {
              const parsed = JSON.parse(content)
              if (parsed.p === 'hcs-6' && parsed.op === 'register') {
                console.log('\n[DISCOVERED] New dApp Registered!')
                console.log(`- Name: ${parsed.name}`)
                console.log(`- Desc: ${parsed.description}`)
                console.log(`- URL:  ${parsed.url}`)
                console.log(`- Timestamp: ${message.consensusTimestamp.toDate()}`)

                // Disconnect and resolve once we found our app
                resolve()
              }
            } catch (e) {
              console.log('[INFO] Non-JSON message ignored.')
            }
          }
        )
    })

    console.log('\n KEY CONCEPT:')
    console.log('HCS-6 allows the ecosystem to build decentralized App Stores where no')
    console.log('single entity can de-platform a developer. It acts as a global,')
    console.log('censorship-resistant yellow pages for Web3 services.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Execution Error:', error.message)
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
