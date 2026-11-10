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
 * This lab follows HCS-2 (HOL's registry standard): the topic memo is
 * "hcs-2:0:<ttl>" (an indexed registry, where every entry counts), each entry is a
 * {"p":"hcs-2","op":"register","t_id":...} message, and t_id points at the app's
 * manifest, a JSON file inscribed with HCS-1. Any HCS-2 reader can list the apps.
 * *
 * [ LEARNABLE MOMENT ]
 * A registry topic gives every entry a consensus order and timestamp that nobody can rewrite. Agreeing on a shared message schema (such as HCS-2) is what lets other apps read your registry without asking you.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-2/
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ LEARNING PATH ]
 * - Previous: M5 Lab 04: HCS Precision Benchmarking (Latency Teardown)
 * - Next:     M5 Lab 06: Revenue-Generating Paid Topics & Tokenized Data Streams (HIP-991)
 *
 * [ SEQUENCE ]
 * Developer -> Hedera: Inscribe the app manifest (HCS-1)
 * Developer -> Hedera: Create an HCS-2 registry (memo hcs-2:0:86400)
 * Developer -> Registry: register { t_id: manifest topic }
 * Client -> Registry: Subscribe and read the register entries
 * Client -> Hedera: Rebuild each manifest (HCS-1) and list the app
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M5_Hedera_Consensus_Service/05_hcs6_registry.js
 * ============================================================================
 */

import { PrivateKey, TopicMessageQuery } from '@hiero-ledger/sdk'
import { buildHcs2CreateRegistryTx, buildHcs2RegisterTx } from '@hashgraphonline/standards-sdk'
import { getClient, exitIfStuck, inscribeHcs1, readHcs1 } from '../M99_Utilities/index.js'

const main = async () => {
  // Never hang: fail with a clear message if the network never answers.
  exitIfStuck(180_000, 'subscription messages')
  console.log('--- SESSION START: App Registry on HCS (HCS-2) ---\n')

  const { client, operatorKey } = getClient()
  const submitKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. The app manifest, inscribed as an HCS-1 file
    const manifest = {
      name: 'Hedera By Example',
      description: 'Hands-on Hedera labs (course demo entry).',
      url: 'https://hbe.expo.app',
      tags: ['education', 'web3', 'hiero'],
      version: '1.0.0'
    }
    console.log('[PROCESS] Inscribing the app manifest as an HCS-1 file...')
    const manifestTopicId = await inscribeHcs1(client, Buffer.from(JSON.stringify(manifest)), 'application/json')
    console.log(`[SUCCESS] Manifest: hcs://1/${manifestTopicId}`)

    // 2. An indexed HCS-2 registry (only our submit key can write to it)
    console.log('\n[PROCESS] Creating an HCS-2 registry topic (indexed, 1-day TTL)...')
    const createTx = await buildHcs2CreateRegistryTx({ registryType: 0, ttl: 86400, submitKey: submitKey.publicKey }).freezeWith(client)
    const topicId = (await (await (await createTx.sign(submitKey)).execute(client)).getReceipt(client)).topicId.toString()
    console.log(`[SUCCESS] Registry Topic created: ${topicId}`)

    // 3. Register the app: t_id points at the manifest
    console.log('\n[PROCESS] Submitting the HCS-2 register entry...')
    const registerTx = await buildHcs2RegisterTx({ registryTopicId: topicId, targetTopicId: manifestTopicId, metadata: `hcs://1/${manifestTopicId}`, memo: 'Hedera By Example course app' }).freezeWith(client)
    const receipt = await (await (await registerTx.sign(submitKey)).execute(client)).getReceipt(client)
    console.log(`[SUCCESS] App registered on-chain! Sequence Number: ${receipt.topicSequenceNumber.toString()}`)

    // 4. A client discovers apps: subscribe, keep HCS-2 register entries, rebuild each manifest
    console.log('\n[PROCESS] Subscribing to the Registry to discover new services...')
    await new Promise((resolve, reject) => {
      new TopicMessageQuery()
        .setTopicId(topicId)
        .setStartTime(0)
        .subscribe(
          client,
          (error) => reject(error),
          async (message) => {
            let entry
            try { entry = JSON.parse(Buffer.from(message.contents).toString('utf8')) } catch (_) { return console.log('[INFO] Non-JSON message ignored.') }
            if (entry.p !== 'hcs-2' || entry.op !== 'register') return
            try {
              const app = JSON.parse((await readHcs1(entry.t_id)).bytes.toString())
              console.log('\n[DISCOVERED] New dApp Registered!')
              console.log(`- Name: ${app.name}`)
              console.log(`- Desc: ${app.description}`)
              console.log(`- URL:  ${app.url}`)
              console.log(`- Manifest: hcs://1/${entry.t_id} (SHA-256 checked)`)
              console.log(`- Timestamp: ${message.consensusTimestamp.toDate()}`)
              resolve()
            } catch (error) { reject(error) }
          }
        )
    })

    console.log('\n KEY CONCEPT:')
    console.log('A public registry topic lets anyone list or discover services without a')
    console.log('single gatekeeper. HCS-2 fixes the message format, so any reader can use it;')
    console.log('the submit key decides who may add entries.')

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
