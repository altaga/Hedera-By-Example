/**
 * ============================================================================
 * Lab 05: Decentralized App Registry on HCS
 * [CONCEPT] On-Chain Service Discovery
 * ============================================================================
 * [ KEY CONCEPT ]
 * A registry on HCS is a topic where each message registers an entry, and anyone
 * can rebuild the list by reading the topic in order. Instead of relying on a
 * central app store, developers publish their dApp's name, website and addresses
 * to a public topic, and clients listen to it to discover services.
 * The HOL standards define registry formats (HCS-2 for registries, HCS-6 for
 * dynamic hashinals). This lab uses its own small app-listing schema to show the
 * pattern; it does not implement HCS-6.
 * *
 * [ LEARNABLE MOMENT ]
 * A registry topic gives every entry a consensus order and timestamp that nobody can rewrite. Agreeing on a shared message schema (such as HCS-2) is what lets other apps read your registry without asking you.
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
  console.log('--- SESSION START: App Registry on HCS ---\n')

  const { client } = getClient()

  try {
    // 1. Create a Topic to act as our decentralized Registry
    console.log('[PROCESS] Creating an HCS Topic for the Registry...')
    let tx = await new TopicCreateTransaction()
      .setTopicMemo('HBE App Registry (demo)')
      .execute(client)

    let receipt = await tx.getReceipt(client)
    const topicId = receipt.topicId
    console.log(`[SUCCESS] Registry Topic created: ${topicId.toString()}`)

    // 2. Define the registration payload (a simple schema made for this lab)
    const hcs6Payload = {
      p: 'hbe-app-registry', // this lab's own schema (not HCS-6)
      op: 'register',
      name: 'Hedera For Dummies dApp',
      description: 'Hands-on Hedera labs (course demo entry).',
      tags: ['education', 'web3', 'hiero'],
      url: 'https://hbe.expo.app',
      metadata: {
        version: '1.0.0',
        author: 'VAI'
      }
    }

    console.log('\n[PROCESS] Submitting Registration Payload...')
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
              if (parsed.p === 'hbe-app-registry' && parsed.op === 'register') {
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
    console.log('A public registry topic lets anyone list or discover services without a')
    console.log('single gatekeeper. Because the topic is open, anyone can also post junk,')
    console.log('so readers must filter entries (for example, by a submit key or signatures).')

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
