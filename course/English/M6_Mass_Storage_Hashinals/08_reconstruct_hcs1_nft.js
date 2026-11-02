/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 08: HCS-1 NFT Reconstruction
 * [ CONCEPT ] Recursive Asset Resolution
 * ============================================================================
 * [ KEY CONCEPT ]
 * Zero-Trust Assets: This script demonstrates how to resolve a "Ledger-Native"
 * NFT without relying on IPFS or central servers. By starting with a Token ID,
 * we find the HCS pointer and recursively reconstruct both the metadata and
 * the high-res binary image directly from Mirror Node shards.
 * *
 * [ LEARNABLE MOMENT ]
 * Client-side verification of HCS-1 NFT inscriptions guarantees provenance: wallets can query the Mirror Node, reassemble the chunks in browser memory, and render verified on-chain artwork autonomously.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hashgraphonline.com/standards/hcs-1/
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 07: HCS-1 Native NFT
 * - Next:     M6 Lab 09: HCS-7 Smart Hashinals
 *
 * [ HOW TO RUN ]
 * node 08_reconstruct_hcs1_nft.js
 * ============================================================================
 */

import { getMirrorNodeBaseUrl, getState, waitForMirror } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- SESSION START: HCS-1 NFT Reconstruction ---\n')

  const tokenId = getState('HCS_NFT_TOKEN_ID') || getState('NFT_TOKEN_ID')
  const mirrorNodeUrl = getMirrorNodeBaseUrl()

  if (!tokenId) {
    console.error('[❌ FAILED] Missing Token ID in state. Run Lab 07 first.')
    process.exitCode = 1
    return
  }

  try {
    // 1. Get NFT Metadata Pointer (Serial #1)
    console.log(`[⚙️ PROCESS] Fetching NFT Metadata Pointer for ${tokenId} Serial 1...`)
    // A freshly minted NFT shows up on the Mirror Node a few seconds after consensus.
    const nftResponse = await waitForMirror(async () => {
      const res = await fetch(`${mirrorNodeUrl}/api/v1/tokens/${tokenId}/nfts/1`)
      return res.ok ? res : null
    })
    if (!nftResponse) throw new Error(`Token not found or Mirror Node error: ${tokenId}/nfts/1`)

    const nftData = await nftResponse.json()
    const rawMetadata = Buffer.from(nftData.metadata, 'base64').toString()
    console.log(`[✅ SUCCESS] Pointer Found: "${rawMetadata}"`)

    if (!rawMetadata.startsWith('hcs://')) {
      throw new Error('This NFT does not appear to be an HCS-1 Native NFT.')
    }

    // Parse hcs://<topicId>?fid=<fid>
    const [topicPart, queryPart] = rawMetadata.replace('hcs://', '').split('?')
    const topicId = topicPart
    const query = new URLSearchParams(queryPart || '')
    const metaFid = query.get('fid')

    console.log(`[📊 LOG] Target Topic: ${topicId}`)
    console.log(`[📊 LOG] Metadata FID: ${metaFid}`)

    // 2. Fetch all messages from the HCS Topic
    console.log(`\n[⚙️ PROCESS] Fetching HCS messages from Topic ${topicId}...`)
    let nextLink = `/api/v1/topics/${topicId}/messages`
    const allMessages = []

    while (nextLink) {
      const response = await fetch(`${mirrorNodeUrl}${nextLink}`)
      const data = await response.json()
      allMessages.push(...data.messages)
      nextLink = data.links?.next || null
    }
    console.log(`[✅ SUCCESS] Retrieved ${allMessages.length} total HCS messages.`)

    // Helper to reconstruct file from shards
    const reconstructFile = (messages, targetFid) => {
      const shards = messages
        .map(m => {
          try {
            const decoded = Buffer.from(m.message, 'base64').toString()
            return JSON.parse(decoded)
          } catch (e) { return null }
        })
        .filter(sh => sh && sh.h === 'hcs-1' && sh.fid === targetFid)

      if (shards.length === 0) throw new Error(`No shards found for FID: ${targetFid}`)

      shards.sort((a, b) => a.i - b.i)
      const totalExpected = shards[0].t
      if (shards.length < totalExpected) throw new Error(`Incomplete data: ${shards.length}/${totalExpected} shards found.`)

      let fullBase64 = ''
      shards.forEach(sh => fullBase64 += sh.d)
      return Buffer.from(fullBase64, 'base64')
    }

    // 3. Reconstruct Metadata JSON
    console.log('\n[⚙️ PROCESS] Reconstructing Metadata JSON...')
    const metaBuffer = reconstructFile(allMessages, metaFid)
    const metadata = JSON.parse(metaBuffer.toString())
    console.log('[✅ SUCCESS] Metadata Reconstructed:')
    console.log(JSON.stringify(metadata, null, 2))

    // 4. Extract and Reconstruct Image
    const imagePointer = metadata.image
    if (!imagePointer.startsWith('hcs://')) {
      throw new Error('Metadata image pointer is not HCS-1 compliant.')
    }

    const [imageTopicPart, imageQueryPart] = imagePointer.replace('hcs://', '').split('?')
    const imageQuery = new URLSearchParams(imageQueryPart || '')
    const imageFid = imageQuery.get('fid')

    console.log(`\n[⚙️ PROCESS] Reconstructing Image (FID: ${imageFid})...`)
    const imageBuffer = reconstructFile(allMessages, imageFid)

    // 5. Save to Disk
    const __dirname = path.dirname(import.meta.filename)
    const outputPath = path.resolve(__dirname, './assets/reconstructed_nft.png')

    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    }
    fs.writeFileSync(outputPath, imageBuffer)

    console.log('\n[🎉 SUCCESS] NFT Asset Fully Reconstructed!')
    console.log(`[ℹ️ INFO] Saved to: ${outputPath}`)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Zero-Trust Assets: Notice how we never used a central database or IPFS.')
    console.log('Every byte of the metadata and the image came directly from the')
    console.log('Hedera Consensus Service via a Mirror Node. This is true permanence.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Reconstruction Failed:', error.message)
    process.exitCode = 1
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
