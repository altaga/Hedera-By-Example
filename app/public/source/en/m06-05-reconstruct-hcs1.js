/**
 * ============================================================================
 * Lab 05: HCS-1 Data Reconstruction (Image Example)
 * [CONCEPT] Subscription-to-State Mirror Node Retrieval
 * ============================================================================
 * [ KEY CONCEPT ]
 * Trustless Reconstruction: the reader fetches every chunk from the Mirror Node,
 * sorts them by "o", strips the data URI prefix, decompresses with zstd and
 * hashes the result. If the SHA-256 matches the topic memo, the image is
 * byte-for-byte the one that was inscribed, with no central server involved.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Reconstructing an HCS-1 file means sorting the chunks by their order field, decompressing, and checking the SHA-256 against the topic memo before trusting the bytes.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 04: The Economic HCS-1 Standard (JSON Sharding)
 * - Next:     M6 Lab 06: Digital Asset Evolution (Dynamic Hashinals, HCS-6)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: none needed (it only reads the Mirror Node).
 * - Run first: M6 Lab 04 (this lab reads what it saved).
 * - Cost: free (Mirror Node reads only).
 *
 * [ HOW TO RUN ]
 * node English/M6_Mass_Storage_Hashinals/05_reconstruct_hcs1.js
 * ============================================================================
 */

import { getState, readHcs1, show } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- SESSION START: HCS-1 Data Reconstruction ---\n')

  const topicId = getState('HCS1_TOPIC_ID')

  if (!topicId) {
    console.error('[FAILED] Missing HCS1_TOPIC_ID in state. Run M6 Lab 04 first.')
    process.exitCode = 1
    return
  }

  try {
    console.log(`[PROCESS] Reading HCS-1 file hcs://1/${topicId} from the Mirror Node...`)
    console.log('[INFO] Steps: fetch all {o, c} chunks -> sort by o -> strip data URI -> zstd decompress -> SHA-256')

    // readHcs1 only returns when the SHA-256 of the decompressed bytes matches the topic memo.
    const file = await readHcs1(topicId)
    show.shards({ id: 'hcs1-stitch', title: 'HCS-1 chunks reassembled', total: file.chunks, done: file.chunks })
    console.log(`[LOG] Chunks: ${file.chunks} | MIME type: ${file.mimeType}`)
    console.log(`[VERIFY] SHA-256 of the rebuilt file matches the topic memo: ${file.hash}`)

    const dateStr = new Date().toISOString().split('T')[0]
    const outputPath = path.resolve(import.meta.dirname, `./output/reconstructed_${dateStr}.png`)
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, file.bytes)

    console.log('\n[SUCCESS] Reconstruction Complete!')
    console.log(`[LOG] Final Image Size: ${file.bytes.length} bytes`)
    console.log(`[INFO] Successfully saved to: ${outputPath}`)

    console.log('\n KEY CONCEPT:')
    console.log('Trustless Reconstruction: the chunks came back in order, and the SHA-256 of')
    console.log('the decompressed file matched the topic memo, so the rebuilt image is')
    console.log('byte-for-byte the one that was inscribed.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Reconstruction Failed:', error.message)
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
