/**
 * ============================================================================
 * Lab 04: The Economic HCS-1 Standard (JSON Sharding)
 * [CONCEPT] Hyper-Efficient High-Volume Storage
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Cost of Consensus: While HFS is great for persistent storage, HCS is
 * significantly cheaper. HCS-1 is a community standard for storing a file in a
 * topic: the file is compressed with zstd, base64-encoded behind a data URI,
 * and split into ordered {"o", "c"} messages. The topic has a submit key, no
 * admin key, and its memo is "<sha256 of the file>:zstd:base64", so any reader
 * (for example the Kiloscribe CDN) can rebuild the file and check it.
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

import { getClient, updateState, show, inscribeHcs1 } from '../M99_Utilities/index.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

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
    console.log(`[LOG] Payload Identity (SHA-256): ${crypto.createHash('sha256').update(fileBuffer).digest('hex')}`)

    // HCS-1: zstd -> base64 data URI -> {o, c} chunks on a topic with a submit key and no admin key.
    console.log('\n[PROCESS] Inscribing the file as HCS-1 (zstd + base64, memo "<sha256>:zstd:base64")...')
    const topicId = await inscribeHcs1(client, fileBuffer, 'image/png', {
      onChunk: (done, total) => {
        show.shards({ id: 'hcs1-upload', title: 'HCS-1 chunks submitted', total, done })
        console.log(`[PROCESS] Chunk ${done}/${total} submitted`)
      }
    })

    console.log(`\n[SUCCESS] HCS-1 file inscribed in topic ${topicId}`)
    console.log(`[LOG] HRL: hcs://1/${topicId}`)
    console.log(`[EXPLORER] https://hashscan.io/testnet/topic/${topicId}`)
    console.log(`[LOG] HCS-1 CDN (Kiloscribe): https://kiloscribe.com/api/inscription-cdn/${topicId}?network=testnet`)

    // Persist Topic ID for reconstruction in step 05
    updateState('HCS1_TOPIC_ID', topicId)

    console.log('\n KEY CONCEPT:')
    console.log('The Cost of Consensus: By using HCS for storage, you pay one message fee')
    console.log('per chunk. zstd shrinks the file first, and the memo hash lets any HCS-1')
    console.log('reader confirm it rebuilt exactly this file.')

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
