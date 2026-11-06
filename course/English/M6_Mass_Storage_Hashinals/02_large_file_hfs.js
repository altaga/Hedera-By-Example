/**
 * ============================================================================
 * Lab 02: Native Hedera File Service (HFS) - Large Files
 * [CONCEPT] Anchor and Append Pattern
 * ============================================================================
 * [ KEY CONCEPT ]
 * The Multi-Transaction Bridge: Hedera transactions are limited in size to
 * ensure network stability. To store large data, you use an "Anchor and
 * Append" pattern. You initialize the file with a `FileCreateTransaction`
 * and then stream the remaining data segments using `FileAppendTransaction`.
 * This allows for uploading high-res images or datasets directly to the ledger.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Storing larger files on HFS requires sequential FileAppendTransaction calls. Always track remaining byte offsets and handle transaction fee limits when appending multi-megabyte smart contract bytecodes.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/file-service/append-to-a-file
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 01: Native Hedera File Service (HFS) - Normal Files
 * - Next:     M6 Lab 03: HFS Batch Operations (Multi-Asset Append)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ each run (it uploads a file, about 1.2 USD).
 *
 * [ HOW TO RUN ]
 * node English/M6_Mass_Storage_Hashinals/02_large_file_hfs.js
 * ============================================================================
 */

import {
  PrivateKey,
  FileCreateTransaction, FileAppendTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState, getHashscanUrl } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- SESSION START: Native HFS (Large File Upload) ---\n')

  const { client, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    const __dirname = path.dirname(import.meta.filename)
    const filePath = path.resolve(__dirname, './assets/largeFile.png')
    if (!fs.existsSync(filePath)) {
      throw new Error(`Asset not found at ${filePath}. Please ensure assets/largeFile.png exists.`)
    }

    const fileBuffer = fs.readFileSync(filePath)
    console.log(`[INFO] Reading "${path.basename(filePath)}" (${fileBuffer.length} bytes)...`)

    // 1. CREATE THE FILE (Initial Chunk)
    // 4KB is a safe limit for Hedera transactions
    const CHUNK_SIZE = 4096
    const initialChunk = fileBuffer.slice(0, CHUNK_SIZE)

    console.log(`[PROCESS] Initializing file anchor with ${initialChunk.length} bytes...`)
    const createTx = await new FileCreateTransaction()
      .setExpirationTime(new Date(Date.now() + 31 * 24 * 3600 * 1000)) // Storage is billed by size x lifetime: keep it short on testnet
      .setKeys([adminKey.publicKey])
      .setContents(initialChunk)
      .freezeWith(client)

    const createRes = await createTx.execute(client)
    const createReceipt = await createRes.getReceipt(client)
    const fileId = createReceipt.fileId

    console.log(`\n[SUCCESS] File Anchor Created: ${fileId.toString()}`)

    // 2. APPEND REMAINING BYTES
    for (let i = CHUNK_SIZE; i < fileBuffer.length; i += CHUNK_SIZE) {
      const chunk = fileBuffer.slice(i, i + CHUNK_SIZE)
      console.log(`[PROCESS] Transmitting bytes ${i} to ${i + chunk.length}...`)

      const appendTx = await new FileAppendTransaction()
        .setFileId(fileId)
        .setContents(chunk)
        .freezeWith(client)

      const appendRes = await appendTx.execute(client)
      await appendRes.getReceipt(client)
    }

    console.log(`\n[SUCCESS] Large File Upload Complete: ${fileId.toString()}`)
    console.log(`[LOG] View Initial Transaction: ${getHashscanUrl(createRes)}`)

    // Automatically sync for subsequent steps
    updateState('HFS_FILE_ID', fileId.toString())

    console.log('\n KEY CONCEPT:')
    console.log('The Multi-Transaction Bridge: Understanding chunking is essential for')
    console.log('production. This script shows how to programmatically split data into')
    console.log('4KB "Shards" and stream them to the ledger node safely.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] HFS Large File Upload Failed:', error.message)
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
