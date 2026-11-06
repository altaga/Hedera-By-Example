/**
 * ============================================================================
 * Lab 04: Reading HFS-Backed NFT Data On-Chain
 * [CONCEPT] On-Chain Metadata Resolution
 * ============================================================================
 * [ KEY CONCEPT ]
 * This is "On-Chain Resolution". Unlike a web database where data can be
 * deleted or altered, once metadata is on HFS and pointed to by an NFT, it is
 * permanently linked and verifiable by anyone in the world. To read an NFT,
 * you follow the cryptographic breadcrumbs from the Token to the File Service.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Querying NFT metadata via Mirror Nodes avoids paying query fees to consensus nodes. Mirror Nodes continuously decode and cache metadata bytes, providing instant REST endpoints for wallets and marketplaces.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/rest-api#get-nft-info
 *
 * [ LEARNING PATH ]
 * - Previous: M3 Lab 03: NFT HIP-412
 * - Next:     M3 Lab 05: Custom Fees
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M3 Lab 03 (this lab reads what it saved).
 * - Cost: <0.1 ℏ (network fees only).
 *
 * [ HOW TO RUN ]
 * node 04_read_nft_onchain.js
 * ============================================================================
 */

import {
  FileContentsQuery, NftId,
  TokenId,
  TokenNftInfoQuery
} from '@hiero-ledger/sdk'
import { getClient, getState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: On-Chain NFT Resolution ---\n')

  // Retrieve the Token ID from the local state system
  const TOKEN_ID = getState('NFT_TOKEN_ID') || '0.0.8690406'
  const SERIAL_NUMBER = 1

  const { client } = getClient()

  try {
    // Step 1: Query the NFT Info to get the metadata pointer
    console.log(`[PROCESS] Querying NFT Info for Token ${TOKEN_ID}, Serial #${SERIAL_NUMBER}...`)
    const nftId = new NftId(TokenId.fromString(TOKEN_ID), SERIAL_NUMBER)

    const nftInfos = await new TokenNftInfoQuery()
      .setNftId(nftId)
      .execute(client)

    if (nftInfos.length === 0) {
      throw new Error('NFT not found.')
    }

    const nftInfo = nftInfos[0]

    // Metadata is stored as a byte array on the ledger, so we convert it to a string
    const metadataPointer = Buffer.from(nftInfo.metadata).toString('utf8')
    console.log(`[SUCCESS] Raw Metadata Pointer Found: ${metadataPointer}`)

    // Step 2: Extract the File ID from the HIP-412 'hedera://' format
    console.log('[INFO] Parsing metadata pointer for File Service resolution...')
    let fileIdString = metadataPointer

    if (metadataPointer.includes('hedera://')) {
      const parts = metadataPointer.split('/')
      fileIdString = parts[parts.length - 1]
    }
    console.log(`[LOG] Target File ID Resolved: ${fileIdString}`)

    // Step 3: Query HFS to download the metadata file contents
    console.log(`[PROCESS] Downloading JSON metadata from HFS File ${fileIdString}...`)
    const fileContents = await new FileContentsQuery()
      .setFileId(fileIdString)
      .execute(client)

    // Decode the raw bytes back into a UTF-8 string, then parse the JSON
    const jsonString = Buffer.from(fileContents).toString('utf8')
    const metadataObj = JSON.parse(jsonString)

    // Step 4: Display the final results
    console.log('\n---  SUCCESS: DECODED ON-CHAIN NFT DATA ---')
    console.log(`[LOG] Token Name:   ${metadataObj.name}`)
    console.log(`[LOG] Creator:      ${metadataObj.creator}`)
    console.log(`[LOG] Description:  ${metadataObj.description}`)
    console.log(`[LOG] Image URI:    ${metadataObj.image}`)

    console.log('\n[LOG] Full Metadata Metadata Signature:')
    console.log(JSON.stringify(metadataObj, null, 2))

    console.log('\n KEY CONCEPT:')
    console.log('This is "On-Chain Resolution". Unlike a web database where data can be')
    console.log('deleted, once metadata is on HFS and pointed to by an NFT, it is')
    console.log('permanently linked and verifiable by anyone in the world.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Resolution Query Failed:', error.message)
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
