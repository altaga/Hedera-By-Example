/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: HFS Batch Operations (Multi-Asset Append)
 * [ CONCEPT ] Composite On-Chain Asset Bundling
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Composite Asset Pattern: Instead of creating 100 different File IDs
 * for 100 assets, you can "Stream" them all into a single File ID by
 * manually managing the byte boundaries. This is highly efficient, reduces
 * "On-Chain Noise", and allows you to package entire decentralized
 * applications (UI, logic, and assets) inside a single, immutable ledger record.
 * *
 * [ LEARNABLE MOMENT ]
 * Batching file appends with deterministic chunk sizes avoids transaction size rejection while maximizing network throughput during bulk asset uploads.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/file-service/append-to-a-file
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 02: Large File HFS
 * - Next:     M6 Lab 04: Economic HCS-1
 *
 * [ HOW TO RUN ]
 * node 03_batch_uploading.js
 * ============================================================================
 */

import { FileAppendTransaction, FileId } from '@hiero-ledger/sdk'
import { getClient, getHashscanUrl, getState } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- SESSION START: HFS Multi-Asset Batch Upload ---\n')

  const { client } = getClient()
  const fileId = getState('HFS_FILE_ID')

  if (!fileId) {
    console.error('[❌ FAILED] Missing HFS_FILE_ID in configuration.')
    process.exitCode = 1
    return
  }

  try {
    const __dirname = path.dirname(import.meta.filename)
    const assetsDir = path.resolve(__dirname, './assets')
    const files = fs.readdirSync(assetsDir)

    console.log(`[ℹ️ INFO] Scanning assets directory: ${assetsDir}`)
    console.log(`[📊 LOG] Found ${files.length} files to anchor.`)

    let combinedBuffer = Buffer.from('\n--- MULTI-ASSET MANIFEST START ---\n')

    for (const file of files) {
      const filePath = path.join(assetsDir, file)
      const stats = fs.statSync(filePath)
      const content = fs.readFileSync(filePath)

      console.log(`[⚙️ PROCESS] Packing ${file} (${stats.size} bytes)...`)

      combinedBuffer = Buffer.concat([
        combinedBuffer,
        Buffer.from(`\nFILE: ${file}\nTYPE: ${path.extname(file)}\nSIZE: ${stats.size}\n`),
        content,
        Buffer.from('\n--- END OF FILE ---\n')
      ])
    }

    console.log(`\n[ℹ️ INFO] Final Combined Payload: ${combinedBuffer.length} bytes`)

    // Manual chunking to ensure stability for very large multi-asset bundles
    const CHUNK_SIZE = 4096
    let lastResponse

    console.log(`[⚙️ PROCESS] Uploading in ${Math.ceil(combinedBuffer.length / CHUNK_SIZE)} shards...`)

    for (let i = 0; i < combinedBuffer.length; i += CHUNK_SIZE) {
      const chunk = combinedBuffer.slice(i, i + CHUNK_SIZE)
      console.log(` └─ [APPEND] Shard ${Math.floor(i / CHUNK_SIZE) + 1}: ${chunk.length} bytes`)

      const transaction = await new FileAppendTransaction()
        .setFileId(FileId.fromString(fileId))
        .setContents(chunk)
        .freezeWith(client)

      lastResponse = await transaction.execute(client)
      await lastResponse.getReceipt(client)
    }

    console.log(`\n[✅ SUCCESS] Multi-Asset Bundle Appended to File: ${fileId}`)
    console.log(`[📊 LOG] View Last Transaction: ${getHashscanUrl(lastResponse)}`)

    console.log('\n💡 KEY CONCEPT:')
    console.log('The Composite Asset Pattern: This demonstrates how to package complex')
    console.log('decentralized applications where the UI, the logic, and the assets all')
    console.log('live inside a single, immutable ledger record.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] HFS Batch Operation Failed:', error.message)
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
