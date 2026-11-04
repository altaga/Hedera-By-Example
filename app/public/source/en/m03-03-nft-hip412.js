/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 03: HIP-412 NFT Metadata & On-Chain Storage (HFS)
 * [CONCEPT] Verifiable Digital Ownership & Immutable Files
 * ============================================================================
 * [ KEY CONCEPT ]
 * HIP-412 is the "Gold Standard" for Hedera NFTs. By following it, your
 * NFTs automatically become compatible with all Hedera wallets and
 * marketplaces. Storing metadata on the Hedera File Service (HFS) ensures
 * the digital asset's "Identity" is just as decentralized as its "Ownership".
 * *
 * [ LEARNABLE MOMENT ]
 * Never store raw high-resolution image bytes directly on the ledger. Host the media on IPFS, Arweave, or HCS, and mint the NFT with its standardized HIP-412 JSON URI to optimize network performance and state rent.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-412
 *
 * [ LEARNING PATH ]
 * - Previous: M3 Lab 02: Financial Identity
 * - Next:     M3 Lab 04: Read NFT On-Chain
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~25 ℏ the first time (it creates a token and uploads a file, about 1.4 USD); ~9 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node 03_nft_hip412.js
 * ============================================================================
 */

import {
  AccountId,
  FileAppendTransaction,
  FileCreateTransaction,
  PrivateKey,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType
} from '@hiero-ledger/sdk'
import fs from 'fs'
import path from 'path'
import { getClient, updateState, reuseToken } from '../M99_Utilities/index.js'

/**
 * Generates HIP-412 V2 compliant metadata.
 */
const generateHIP412Metadata = (name, description, imageURI, creator, attributesMap) => {
  return {
    name,
    creator,
    description,
    image: imageURI,
    type: 'image/png',
    format: 'HIP412@2.0.0',
    properties: {
      ...attributesMap
    },
    attributes: Object.entries(attributesMap).map(([traitType, value]) => ({
      trait_type: traitType,
      value
    }))
  }
}

const main = async () => {
  console.log('--- SESSION START: HFS-Backed NFT Minting ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const treasuryKey = PrivateKey.fromString(operatorKey)

  try {
    // 1. Upload Logo to Hedera File Service (HFS)
    const __dirname = path.dirname(import.meta.filename)
    const imagePath = path.resolve(__dirname, './assets/logonft.png')

    if (!fs.existsSync(imagePath)) {
      throw new Error(`Logo not found at ${imagePath}`)
    }

    const imageBuffer = fs.readFileSync(imagePath)
    console.log(`[PROCESS] Uploading image (${imageBuffer.length} bytes) to HFS in 4KB segments...`)

    // A. CREATE THE FILE (Initial 4KB)
    const CHUNK_SIZE = 4096
    const initialChunk = imageBuffer.slice(0, CHUNK_SIZE)

    const fileTx = await new FileCreateTransaction()
      .setExpirationTime(new Date(Date.now() + 31 * 24 * 3600 * 1000)) // Storage is billed by size x lifetime: keep it short on testnet
      .setKeys([treasuryKey.publicKey])
      .setContents(initialChunk)
      .freezeWith(client)

    const fileResponse = await fileTx.execute(client)
    const fileReceipt = await fileResponse.getReceipt(client)
    const fileId = fileReceipt.fileId

    console.log(`[INFO] File Object Initialized: ${fileId.toString()}`)

    // B. APPEND REMAINING BYTES
    for (let i = CHUNK_SIZE; i < imageBuffer.length; i += CHUNK_SIZE) {
      const chunk = imageBuffer.slice(i, i + CHUNK_SIZE)
      console.log(`[PROCESS] Appending bytes ${i} to ${i + chunk.length}...`)

      const appendTx = await new FileAppendTransaction()
        .setFileId(fileId)
        .setContents(chunk)
        .freezeWith(client)

      const appendResponse = await appendTx.execute(client)
      await appendResponse.getReceipt(client)
    }

    console.log(`[SUCCESS] Image Upload Complete: ${fileId.toString()}`)
    console.log(`[LOG] HashScan View: https://hashscan.io/testnet/file/${fileId.toString()}`)

    // 2. Create the NFT Collection
    console.log("\n[PROCESS] Initializing the 'Hedera Syllabus NFT' collection...")
    const tokenId = await reuseToken('REUSE_M3_03_TOKEN', async () => {
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('Hedera Syllabus NFT')
        .setTokenSymbol('HSNFT')
        .setTokenType(TokenType.NonFungibleUnique)
        .setDecimals(0)
        .setInitialSupply(0)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100)
        .setSupplyKey(treasuryKey)
        .freezeWith(client)

      const tokenResponse = await tokenTx.execute(client)
      const tokenReceipt = await tokenResponse.getReceipt(client)
      return tokenReceipt.tokenId
    })

    console.log(`[SUCCESS] NFT Collection Created: ${tokenId.toString()}`)

    // Automatically sync for use in future labs
    updateState('NFT_TOKEN_ID', tokenId.toString())

    // 3. Construct and Upload Metadata JSON to HFS
    const imageURI = `hedera://${fileId.toString()}`

    const metadataJSON = generateHIP412Metadata(
      'Hedera Badge #1',
      'Proof of completion for Module 3 (HFS Storage)',
      imageURI,
      'Hedera Developer',
      { rarity: 'Legendary', storage: 'On-Chain HFS' }
    )

    console.log('\n[LOG] Generated HIP-412 V2 Metadata:')
    console.log(JSON.stringify(metadataJSON, null, 2))

    console.log('\n[PROCESS] Uploading Metadata JSON to HFS as an immutable file...')
    const metadataStr = JSON.stringify(metadataJSON)
    const metadataFileTx = await new FileCreateTransaction()
      .setExpirationTime(new Date(Date.now() + 31 * 24 * 3600 * 1000)) // Storage is billed by size x lifetime: keep it short on testnet
      .setKeys([treasuryKey.publicKey])
      .setContents(metadataStr)
      .freezeWith(client)

    const metadataFileRes = await metadataFileTx.execute(client)
    const metadataFileReceipt = await metadataFileRes.getReceipt(client)
    const metadataFileId = metadataFileReceipt.fileId

    console.log(`[SUCCESS] Metadata Stored On-Chain: ${metadataFileId.toString()}`)

    // 4. Batch Mint 5 NFT Serials pointing to the Metadata File
    console.log(`\n[PROCESS] Minting Serials #1 through #5 for Token ${tokenId.toString()}...`)
    const metadataPointer = `hedera://1/${metadataFileId.toString()}`

    const mintTx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .addMetadata(Buffer.from(metadataPointer))
      .addMetadata(Buffer.from(metadataPointer))
      .addMetadata(Buffer.from(metadataPointer))
      .addMetadata(Buffer.from(metadataPointer))
      .addMetadata(Buffer.from(metadataPointer))
      .freezeWith(client)

    const mintResponse = await mintTx.execute(client)
    const mintReceipt = await mintResponse.getReceipt(client)

    // Format Transaction ID for HashScan
    const rawTxId = mintResponse.transactionId.toString()
    const [accountId, timestamp] = rawTxId.split('@')
    const txId = `${accountId}-${timestamp.replace('.', '-')}`

    console.log(`[LOG] View Mint Transaction: https://hashscan.io/testnet/transaction/${txId}`)

    console.log(`\n[SUCCESS] Success! Minted Serials: ${mintReceipt.serials.join(', ')}`)
    console.log(`[LOG] Metadata File: ${metadataFileId.toString()}`)

    console.log('\n KEY CONCEPT:')
    console.log('HIP-412 is the "Gold Standard" for Hedera NFTs. By following it, your')
    console.log('NFTs automatically become compatible with all Hedera wallets and')
    console.log('marketplaces (like HashPack and SentX).')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] NFT Operation Failed:', error.message)
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
