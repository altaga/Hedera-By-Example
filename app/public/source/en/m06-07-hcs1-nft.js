/**
 * ============================================================================
 * Lab 07: HCS-1 Native NFT (Metadata + Image on HCS)
 * [CONCEPT] Fully Decentralized Digital Artifacts
 * ============================================================================
 * [ KEY CONCEPT ]
 * Beyond IPFS: While IPFS is common, it still relies on external availability.
 * Here BOTH the image and the HIP-412 metadata are HCS-1 files, and the NFT's
 * metadata is the HRL "hcs://1/<metadata topic>": this is a Hashinal (HCS-5).
 * Any Mirror Node that keeps topic history, or the Kiloscribe CDN, can serve
 * it, with no pinning service to pay.
 * *
 * [ LEARNABLE MOMENT ]
 * Binding an HCS-1 inscription topic directly to an HTS non-fungible token creates a fully on-chain digital asset with no reliance on external IPFS pinning services.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hol.org/docs/standards/hcs-1/
 * - https://hol.org/docs/standards/hcs-5/
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 06: Digital Asset Evolution (Hashinals)
 * - Next:     M6 Lab 08: HCS-1 NFT Reconstruction
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD); ~3 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M6_Mass_Storage_Hashinals/07_hcs1_nft.js
 * ============================================================================
 */

import {
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenType,
  TokenSupplyType,
  AccountId,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, updateState, getHashscanUrl, show, reuseToken, inscribeHcs1 } from '../M99_Utilities/index.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const main = async () => {
  console.log('--- SESSION START: HCS-1 Native NFT Minting (Hashinal, HCS-5) ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)

  try {
    const __dirname = path.dirname(import.meta.filename)
    const filePath = path.resolve(__dirname, './assets/largeFile.png')
    if (!fs.existsSync(filePath)) {
      throw new Error(`Asset not found at ${filePath}`)
    }
    const fileBuffer = fs.readFileSync(filePath)
    console.log(`[INFO] Asset: ${path.basename(filePath)} (${fileBuffer.length} bytes)`)
    console.log(`[LOG] Image SHA-256: ${crypto.createHash('sha256').update(fileBuffer).digest('hex')}`)

    // 1. Inscribe the image as an HCS-1 file
    console.log('\n[PROCESS] Inscribing the image as HCS-1...')
    const imageTopicId = await inscribeHcs1(client, fileBuffer, 'image/png', {
      onChunk: (done, total) => show.shards({ id: 'hcs1-image', title: 'Image chunks submitted', total, done })
    })
    console.log(`[SUCCESS] Image inscribed: hcs://1/${imageTopicId}`)

    // 2. Inscribe the HIP-412 metadata (pointing at the image) as a second HCS-1 file
    const metadataJSON = {
      name: 'Economic HCS-1 NFT #1',
      creator: 'Hedera Developer',
      description: 'A Hashinal: image and metadata are both HCS-1 files on Hedera.',
      image: `hcs://1/${imageTopicId}`,
      type: 'image/png',
      format: 'HIP412@2.0.0',
      properties: { standard: 'hcs-5', storage: 'hcs-1' }
    }
    console.log('\n[PROCESS] Inscribing the HIP-412 metadata as HCS-1...')
    const metadataTopicId = await inscribeHcs1(client, Buffer.from(JSON.stringify(metadataJSON)), 'application/json')
    console.log(`[SUCCESS] Metadata inscribed: hcs://1/${metadataTopicId}`)

    // 3. The NFT collection (reused on later runs)
    console.log('\n[PROCESS] Creating NFT Collection...')
    const tokenId = await reuseToken('REUSE_M6_07_TOKEN', async () => {
      // Create the token: its keys (admin, supply, KYC, freeze...) decide who can change it later.
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
      return (await tokenRes.getReceipt(client)).tokenId
    })
    console.log(`[SUCCESS] Collection ID: ${tokenId.toString()}`)

    // 4. Mint: the NFT's metadata is the HRL of the metadata file (HCS-5)
    const hrl = `hcs://1/${metadataTopicId}`
    console.log(`\n[PROCESS] Minting a serial with metadata ${hrl}...`)
    // Mint: only the supply key can create new units or NFT serials.
    const mintRes = await (await new TokenMintTransaction()
      .setTokenId(tokenId)
      .addMetadata(Buffer.from(hrl))
      .freezeWith(client)).execute(client)
    const serial = (await mintRes.getReceipt(client)).serials[0].toString()
    console.log(`\n[SUCCESS] Hashinal minted: ${tokenId} serial #${serial}`)
    console.log(`[LOG] View NFT on Hashscan: ${getHashscanUrl(mintRes)}`)
    console.log(`[LOG] Image via the HCS-1 CDN: https://kiloscribe.com/api/inscription-cdn/${imageTopicId}?network=testnet`)

    console.log('\n KEY CONCEPT:')
    console.log('Ledger-Native Inscription: the metadata and the image are HCS-1 files, so the')
    console.log('NFT depends on no IPFS pin or web server, only on Hedera and its Mirror Nodes.')

    console.log('\n LEARNABLE MOMENT:')
    console.log('Frontend Resolution Logic (HCS-5):')
    console.log(`1. Read the NFT metadata: "${hrl}"`)
    console.log(`2. Rebuild HCS-1 file ${metadataTopicId} (sort {o,c} chunks, zstd decompress, check the memo SHA-256)`)
    console.log(`3. Read "image" from the JSON: "hcs://1/${imageTopicId}"`)
    console.log(`4. Rebuild HCS-1 file ${imageTopicId} the same way -> render.`)

    updateState('HCS_NFT_TOKEN_ID', tokenId.toString())
    updateState('HCS_NFT_SERIAL', serial)
    updateState('HCS_NFT_TOPIC_ID', metadataTopicId)

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Operation Failed:', error.message)
    process.exitCode = 1
    if (client) client.close()
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
