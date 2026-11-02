/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 07: HCS-1 Native NFT (Metadata + Image on HCS)
 * [ CONCEPT ] Fully Decentralized Digital Artifacts
 * ============================================================================
 * [ KEY CONCEPT ]
 * Beyond IPFS: While IPFS is common, it still relies on external availability.
 * By storing BOTH the NFT metadata and the actual image data in HCS shards,
 * your asset becomes 100% "Ledger-Native". Any Mirror Node becomes your
 * storage provider, ensuring the asset exists as long as the network does.
 * *
 * [ LEARNABLE MOMENT ]
 * Binding an HCS-1 inscription topic directly to an HTS non-fungible token creates a fully on-chain 100% decentralized digital asset with zero reliance on external IPFS pinning services.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 06: Hashinals Ecosystem
 * - Next:     M6 Lab 08: HCS-1 NFT Reconstruction
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD); ~3 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node 07_hcs1_nft.js
 * ============================================================================
 */

import {
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenType,
  TokenSupplyType,
  AccountId,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, updateState, getHashscanUrl, show, reuseToken } from '../M99_Utilities/index.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

/**
 * HCS-1 Pipeline: Chunks a buffer into standard JSON messages
 */
const constructHcs1Payloads = (fileBuffer, topicIdStr) => {
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
  console.log('--- SESSION START: HCS-1 Native NFT Minting ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    const __dirname = path.dirname(import.meta.filename)
    const filePath = path.resolve(__dirname, './assets/largeFile.png')
    if (!fs.existsSync(filePath)) {
      throw new Error(`Asset not found at ${filePath}`)
    }

    const fileBuffer = fs.readFileSync(filePath)
    const imageHash = crypto.createHash('sha256').update(fileBuffer).digest('hex')

    console.log(`[ℹ️ INFO] Asset: ${path.basename(filePath)} (${fileBuffer.length} bytes)`)
    console.log(`[📊 LOG] Asset FID: ${imageHash}`)

    // 1. Create the HCS Storage Topic
    console.log('\n[⚙️ PROCESS] Creating HCS Storage Topic...')
    const topicTx = await new TopicCreateTransaction()
      .setTopicMemo('HCS-1 Asset Anchor')
      .freezeWith(client)

    const topicRes = await topicTx.execute(client)
    const topicReceipt = await topicRes.getReceipt(client)
    const topicId = topicReceipt.topicId
    const topicIdStr = topicId.toString()

    console.log(`[✅ SUCCESS] HCS Topic Created: ${topicIdStr}`)

    // 2. Submit Image Shards
    const imagePayloads = constructHcs1Payloads(fileBuffer, topicIdStr)
    console.log(`[ℹ️ INFO] Submitting ${imagePayloads.length} image shards to HCS...`)

    for (const payload of imagePayloads) {
      show.shards({ id: 'hcs1-image', title: 'Image shards submitted', total: payload.t, done: payload.i + 1 })
      process.stdout.write(` └─ [⚙️] Shard ${payload.i + 1}/${payload.t}\r`)
      const submitTx = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify(payload))
        .execute(client)
      await submitTx.getReceipt(client)
    }
    process.stdout.write('\n[✅ SUCCESS] Image Shards Anchored.\n')

    // 3. Construct and Submit Metadata JSON (HIP-412)
    const metadataJSON = {
      name: 'Economic HCS-1 NFT #1',
      creator: 'Hedera Developer',
      description: 'A fully decentralized NFT with image and metadata stored in HCS shards.',
      image: `hcs://${topicIdStr}?fid=${imageHash}`,
      type: 'image/png',
      format: 'HIP412@2.0.0',
      properties: {
        protocol: 'hcs-1',
        storage: 'Hedera Consensus Service'
      }
    }

    const metaBuffer = Buffer.from(JSON.stringify(metadataJSON))
    const metaHash = crypto.createHash('sha256').update(metaBuffer).digest('hex')
    const metaPayloads = constructHcs1Payloads(metaBuffer, topicIdStr)

    console.log(`\n[ℹ️ INFO] Submitting Metadata manifest (${metaPayloads.length} shard)...`)
    for (const payload of metaPayloads) {
      const submitTx = await new TopicMessageSubmitTransaction()
        .setTopicId(topicId)
        .setMessage(JSON.stringify(payload))
        .execute(client)
      await submitTx.getReceipt(client)
    }
    console.log('[✅ SUCCESS] Metadata Shard Anchored.')

    // 4. Create the NFT Collection
    console.log('\n[⚙️ PROCESS] Creating NFT Collection...')
    const tokenId = await reuseToken('REUSE_M6_07_TOKEN', async () => {
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('HCS-1 Economic Artifact')
        .setTokenSymbol('HCSNFT')
        .setTokenType(TokenType.NonFungibleUnique)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100)
        .setSupplyKey(adminKey)
        .freezeWith(client)

      const tokenRes = await tokenTx.execute(client)
      const tokenReceipt = await tokenRes.getReceipt(client)
      return tokenReceipt.tokenId
    })

    console.log(`[✅ SUCCESS] Collection ID: ${tokenId.toString()}`)

    // 5. Mint Serial #1 pointing to HCS Metadata
    // The pointer format: hcs://<TOPIC_ID>?fid=<METADATA_FID>
    const hcsPointer = `hcs://${topicIdStr}?fid=${metaHash}`
    console.log(`\n[⚙️ PROCESS] Minting Serial #1 with Pointer: ${hcsPointer}`)

    const mintTx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .addMetadata(Buffer.from(hcsPointer))
      .freezeWith(client)

    const mintRes = await mintTx.execute(client)
    await mintRes.getReceipt(client)

    console.log('\n[✅ SUCCESS] HCS-1 Native NFT Minted!')
    console.log(`[📊 LOG] View NFT on Hashscan: ${getHashscanUrl(mintRes)}`)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Zero-Trust Autonomous Inscription: The metadata and image are stored')
    console.log('directly within HCS shards, completely eliminating IPFS pinning dependencies.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Frontend Resolution Logic:')
    console.log(`1. Read NFT metadata: "${hcsPointer}"`)
    console.log(`2. Query Mirror Node: /api/v1/topics/${topicIdStr}/messages`)
    console.log(`3. Filter messages where JSON.fid === "${metaHash}"`)
    console.log('4. Reconstruct Metadata JSON -> extract image: "hcs://..."')
    console.log(`5. Filter messages where JSON.fid === "${imageHash}"`)
    console.log('6. Reconstruct Image Base64 -> Render.')

    // Update state for later use
    updateState('HCS_NFT_TOKEN_ID', tokenId.toString())
    updateState('HCS_NFT_TOPIC_ID', topicIdStr)

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Operation Failed:', error.message)
    process.exitCode = 1
    if (client) client.close()
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[❌ FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
