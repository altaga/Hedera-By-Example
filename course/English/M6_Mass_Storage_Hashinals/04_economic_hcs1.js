/**
 * ============================================================================
 * Lab 04: The Economic HCS-1 Standard (JSON Sharding)
 * [CONCEPT] Hyper-Efficient High-Volume Storage
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Cost of Consensus: While HFS is great for persistent storage, HCS is
 * significantly cheaper. HCS-1 is a community standard that splits large
 * files into small, ordered JSON messages (shards). By using HCS for storage,
 * you pay only for the "Fair Ordering" of your shards, allowing massive
 * datasets to be anchored to the ledger for a fraction of the cost of
 * traditional blockchain storage.
 *
 * Format note: this lab uses a simplified HCS-1-style shard ({ h, fid, i, t, d }, no
 * compression) so you can read every message. Real HCS-1 compresses with zstd, puts
 * the hash in the topic memo and sends { o, c } messages, so HCS-1 tools will not
 * read these topics.
 *
 * [ LEARNABLE MOMENT ]
 * The HCS-1 standard enables cost-effective on-chain inscriptions: by sharding large files across ordered consensus messages instead of smart contract storage, developers pay only one message fee per shard, far below contract storage costs.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 03: HFS Batch Operations (Multi-Asset Append)
 * - Next:     M6 Lab 05: HCS-1 Data Reconstruction (Image Example)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: <1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node English/M6_Mass_Storage_Hashinals/04_economic_hcs1.js
 * ============================================================================
 */

import { TopicCreateTransaction, TopicMessageSubmitTransaction } from '@hiero-ledger/sdk'
import { getClient, updateState, show } from '../M99_Utilities/index.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

/**
 * HCS-1 Pipeline: Chunks a buffer into standard JSON messages
 */
const constructHcs1Payloads = (fileBuffer, topicIdStr) => {
  // Hash the content: anyone can recompute this digest to verify the data.
  const fileHashHex = crypto.createHash('sha256').update(fileBuffer).digest('hex')
  const base64Str = fileBuffer.toString('base64')

  const MAX_CHUNK_SIZE = 700 // Safe limit to ensure the JSON object fits in 1024 bytes
  const chunks = []

  for (let i = 0; i < base64Str.length; i += MAX_CHUNK_SIZE) {
    chunks.push(base64Str.slice(i, i + MAX_CHUNK_SIZE))
  }

  return chunks.map((chunk, index) => ({
    h: 'hcs-1',
    fid: fileHashHex, // Tie chunk to original identity
    s: topicIdStr, // Sibling Topic
    i: index, // Current chunk index
    t: chunks.length, // Total chunks expected
    d: chunk // Base64 payload
  }))
}

const main = async () => {
  console.log('--- SESSION START: Economic HCS-1 Data Sharding ---\n')

  const { client } = getClient()

  try {
    const __dirname = path.dirname(import.meta.filename)
    const filePath = path.resolve(__dirname, './assets/largeFile.png')
    if (!fs.existsSync(filePath)) {
      throw new Error(`Asset not found at ${filePath}`)
    }

    const fileBuffer = fs.readFileSync(filePath)
    console.log(`[INFO] Reading binary data from: ${path.basename(filePath)}`)
    console.log(`[LOG] Payload Size: ${fileBuffer.length} bytes`)

    // 1. Create a dedicated topic for our HCS-1 Storage
    console.log('[PROCESS] Creating a dedicated HCS-1 Storage Topic...')
    // Create the topic: an ordered, timestamped message log; a submit key would restrict who can write.
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-1 Asset Anchor')
      .freezeWith(client)

    const topicRes = await topicTx.execute(client)
    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const topicReceipt = await topicRes.getReceipt(client)
    const topicId = topicReceipt.topicId

    console.log(`\n[SUCCESS] HCS-1 Topic Created: ${topicId.toString()}`)

    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')
    console.log(`[LOG] Payload Identity (SHA-256): ${fileHash}`)

    const payloads = constructHcs1Payloads(fileBuffer, topicId.toString())
    console.log(`[INFO] Asset split into ${payloads.length} HCS-1-style shards (simplified format).\n`)

    // 2. Submit Chunked Messages
    for (const payload of payloads) {
      show.shards({ id: 'hcs1-upload', title: 'HCS-1 shards submitted', total: payload.t, done: payload.i + 1 })
      console.log(`[PROCESS] Submitting Shard ${payload.i + 1}/${payload.t}...`)

      // Publish: consensus gives the message a sequence number and a timestamp everyone agrees on.
      const submitTx = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify(payload))
        .execute(client)

      await submitTx.getReceipt(client)
    }

    console.log('\n[SUCCESS] HCS-1 Sharding Lifecycle Complete!')
    console.log('[INFO] Every shard carries the file\'s SHA-256, so a reader can check the rebuilt file.')

    // Persist Topic ID for reconstruction in step 05
    updateState('HCS1_TOPIC_ID', topicId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('The Cost of Consensus: By using HCS for storage, you pay only for the')
    console.log('"Fair Ordering" of your shards. This allows for massive datasets to be')
    console.log('anchored to the ledger for a fraction of the cost of traditional')
    console.log('blockchain storage.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] HCS-1 Operation Failed:', error.message)
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
