/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 01: Native Hedera File Service (HFS) - Normal Files
 * [ CONCEPT ] Ledger-Native Persistence
 * ============================================================================
 * [ KEY CONCEPT ]
 * Ledger-Native Persistence: When you store a file on HFS, it is immediately
 * available to all nodes and is protected by the HBAR ecosystem. Unlike
 * decentralized storage like IPFS which requires a separate infrastructure,
 * HFS is part of the Hedera core. Small files (up to 6KB) can be created
 * in a single atomic transaction.
 * *
 * [ LEARNABLE MOMENT ]
 * Hedera File Service (HFS) stores data directly on consensus nodes with cryptographic immutability. For files under 1024 bytes, FileCreateTransaction provides instant on-chain document storage for legal contracts or public keys.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/file-service
 *
 * [ LEARNING PATH ]
 * - Previous: M5 Lab 04: HCS Ping-Pong
 * - Next:     M6 Lab 02: Large File HFS
 *
 * [ HOW TO RUN ]
 * node 01_native_hfs.js
 * ============================================================================
 */

import {
  FileCreateTransaction,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, updateState, getHashscanUrl } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- SESSION START: Native HFS (Small File Upload) ---\n')

  const { client, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    const __dirname = path.dirname(import.meta.filename)
    const imagePath = path.resolve(__dirname, './assets/test_image.png')
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Asset not found at ${imagePath}`)
    }

    const imageBuffer = fs.readFileSync(imagePath)
    console.log(`[ℹ️ INFO] Reading asset: ${path.basename(imagePath)} (${imageBuffer.length} bytes)`)

    console.log('[⚙️ PROCESS] Creating a permissioned file on Hedera (Single Transaction)...')

    const transaction = await new FileCreateTransaction()
      .setKeys([adminKey.publicKey])
      .setContents(imageBuffer)
      .freezeWith(client)

    const response = await transaction.execute(client)
    const receipt = await response.getReceipt(client)
    const fileId = receipt.fileId

    console.log(`\n[✅ SUCCESS] Small Image File Created: ${fileId.toString()}`)
    console.log(`[📊 LOG] View on HashScan: ${getHashscanUrl(response)}`)

    // Automatically sync for reference (Step 06 looks for HFS_FILE_ID)
    updateState('HFS_FILE_ID', fileId.toString())

    console.log('\n💡 KEY CONCEPT:')
    console.log('Ledger-Native Persistence: When you store a file on HFS, it is')
    console.log('immediately available to all nodes and is protected by the HBAR')
    console.log("ecosystem. This is the ultimate \"Anchor\" for your application's data.")

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] HFS Small File Creation Failed:', error.message)
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
