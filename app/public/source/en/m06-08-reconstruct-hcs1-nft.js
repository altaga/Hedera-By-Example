/**
 * ============================================================================
 * Lab 08: HCS-1 NFT Reconstruction
 * [CONCEPT] Recursive Asset Resolution
 * ============================================================================
 * [ KEY CONCEPT ]
 * Zero-Trust Assets: This script demonstrates how to resolve a "Ledger-Native"
 * NFT without relying on IPFS or central servers. Starting from the token and
 * serial, we read its HRL (hcs://1/<topic>), rebuild the HCS-1 metadata file,
 * then follow its "image" HRL and rebuild the image, checking each SHA-256.
 * *
 * [ LEARNABLE MOMENT ]
 * Client-side resolution of a Hashinal (HCS-5): wallets query the Mirror Node, rebuild each HCS-1 file in memory, check its SHA-256 against the topic memo and render the artwork without a server.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-1/
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 07: HCS-1 Native NFT (Metadata + Image on HCS)
 * - Next:     M6 Lab 09: HCS-7 Smart Hashinals (EVM State + WASM Dynamic Inscriptions)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: none needed (it only reads the Mirror Node).
 * - Run first: M6 Lab 07 (this lab reads what it saved).
 * - Cost: free (Mirror Node reads only).
 *
 * [ HOW TO RUN ]
 * node English/M6_Mass_Storage_Hashinals/08_reconstruct_hcs1_nft.js
 * ============================================================================
 */

import { getMirrorNodeBaseUrl, getState, waitForMirror, readHcs1, show } from '../M99_Utilities/index.js'
import fs from 'fs'
import path from 'path'

const parseHrl = (value) => {
  const match = String(value).match(/^hcs:\/\/1\/(\d+\.\d+\.\d+)$/)
  if (!match) throw new Error(`"${value}" is not an HCS-1 HRL (hcs://1/<topicId>)`)
  return match[1]
}

const main = async () => {
  console.log('--- SESSION START: HCS-1 NFT Reconstruction ---\n')

  const tokenId = getState('HCS_NFT_TOKEN_ID')
  const serial = getState('HCS_NFT_SERIAL')
  const mirrorNodeUrl = getMirrorNodeBaseUrl()

  if (!tokenId || !serial) {
    console.error('[FAILED] Missing the Hashinal in state. Run Lab 07 first.')
    process.exitCode = 1
    return
  }

  try {
    // 1. The NFT's metadata is an HRL pointing at an HCS-1 file
    console.log(`[PROCESS] Fetching the metadata of ${tokenId} serial #${serial}...`)
    // A freshly minted NFT shows up on the Mirror Node a few seconds after consensus.
    const nftResponse = await waitForMirror(async () => {
      const res = await fetch(`${mirrorNodeUrl}/api/v1/tokens/${tokenId}/nfts/${serial}`)
      return res.ok ? res : null
    })
    if (!nftResponse) throw new Error(`Token not found or Mirror Node error: ${tokenId}/nfts/${serial}`)
    const rawMetadata = Buffer.from((await nftResponse.json()).metadata, 'base64').toString()
    console.log(`[SUCCESS] NFT metadata: "${rawMetadata}"`)
    const metadataTopicId = parseHrl(rawMetadata)

    // 2. Rebuild the metadata JSON (readHcs1 checks the SHA-256 against the topic memo)
    console.log(`\n[PROCESS] Rebuilding HCS-1 metadata file ${metadataTopicId}...`)
    const metaFile = await readHcs1(metadataTopicId)
    console.log(`[VERIFY] Metadata SHA-256 matches the topic memo: ${metaFile.hash.slice(0, 16)}...`)
    const metadata = JSON.parse(metaFile.bytes.toString())
    console.log('[SUCCESS] Metadata Reconstructed:')
    console.log(JSON.stringify(metadata, null, 2))

    // 3. Follow the "image" HRL and rebuild the image
    const imageTopicId = parseHrl(metadata.image)
    console.log(`\n[PROCESS] Rebuilding HCS-1 image file ${imageTopicId}...`)
    const imageFile = await readHcs1(imageTopicId)
    show.shards({ id: 'hcs1-stitch', title: 'Image chunks reassembled', total: imageFile.chunks, done: imageFile.chunks })
    console.log(`[VERIFY] Image SHA-256 matches the topic memo: ${imageFile.hash.slice(0, 16)}... (${imageFile.mimeType}, ${imageFile.bytes.length} bytes)`)

    // 4. Save to Disk
    const __dirname = path.dirname(import.meta.filename)
    const outputPath = path.resolve(__dirname, './output/reconstructed_nft.png')
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    }
    fs.writeFileSync(outputPath, imageFile.bytes)

    console.log('\n[SUCCESS] NFT Asset Fully Reconstructed!')
    console.log(`[INFO] Saved to: ${outputPath}`)

    console.log('\n KEY CONCEPT:')
    console.log('Zero-Trust Assets: Notice how we never used a central database or IPFS.')
    console.log('Every byte of the metadata and the image came directly from the')
    console.log('Hedera Consensus Service via a Mirror Node, and its SHA-256 was checked.')

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
