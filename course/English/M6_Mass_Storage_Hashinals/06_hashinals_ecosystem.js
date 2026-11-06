/**
 * ============================================================================
 * Lab 06: Digital Asset Evolution (Hashinals)
 * [CONCEPT] Ledger-Native Digital Artifacts
 * ============================================================================
 * [ KEY CONCEPT ]
 * The hedera:// Protocol: This is a network-native way to reference files. By
 * using this URI in your metadata, you are making your assets "Ledger-Native"
 * and globally resolvable by any Hedera-compatible application. Unlike
 * traditional NFTs that point to a web URL (which can disappear), a Hashinal
 * points directly to an immutable HFS File ID or HCS Topic.
 *
 *
 * [ LEARNABLE MOMENT ]
 * Hashinals bring Bitcoin-style Ordinal inscriptions to Hedera with finality in seconds and negligible carbon footprint, binding permanent media inscriptions directly to HTS token serials.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hashgraphonline.com/
 *
 * [ LEARNING PATH ]
 * - Previous: M6 Lab 05: HCS-1 Data Reconstruction (Image Example)
 * - Next:     M6 Lab 07: HCS-1 Native NFT (Metadata + Image on HCS)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Run first: M6 Lab 01 (this lab reads what it saved).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD); <1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M6_Mass_Storage_Hashinals/06_hashinals_ecosystem.js
 * ============================================================================
 */

import {
  AccountId, PrivateKey,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType
} from '@hiero-ledger/sdk'
import fs from 'fs'
import path from 'path'
import { getClient, getHashscanUrl, getState, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: The Hashinals Ecosystem ---\n')

  const { client, operatorId, operatorKey } = getClient()
  const adminKey = PrivateKey.fromString(operatorKey)
  const hfsFileId = getState('HFS_FILE_ID')

  if (!hfsFileId) {
    console.error('[FAILED] Missing HFS_FILE_ID in configuration. Run Lab 01/02 first.')
    process.exitCode = 1
    return
  }

  try {
    const __dirname = path.dirname(import.meta.filename)
    const metaPath = path.resolve(__dirname, './assets/hedera_meta.md')
    const readmeContent = fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf8') : 'Default Metadata'

    // 1. Create the Hashinal NFT Collection
    console.log("[PROCESS] Creating the 'Hedera Syllabus Hashinal' collection...")
    const tokenId = await reuseToken('REUSE_M6_06_TOKEN', async () => {
      // Create the token: its keys (admin, supply, KYC, freeze...) decide who can change it later.
      const tokenTx = await new TokenCreateTransaction()
        .setTokenName('Hedera Batch Hashinal')
        .setTokenSymbol('HASH')
        .setTokenType(TokenType.NonFungibleUnique)
        .setDecimals(0)
        .setInitialSupply(0)
        .setTreasuryAccountId(AccountId.fromString(operatorId))
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100)
        .setSupplyKey(adminKey)
        .freezeWith(client)

      const tokenResponse = await tokenTx.execute(client)
      // Wait for consensus: the receipt says whether the network accepted the transaction.
      const tokenReceipt = await tokenResponse.getReceipt(client)
      return tokenReceipt.tokenId
    })

    console.log(`\n[SUCCESS] Hashinal Collection Created: ${tokenId.toString()}`)

    // 2. Define the Hashinal Metadata (hedera:// protocol)
    const metadataJSON = {
      name: 'Hedera Hashinal #1',
      creator: 'Hedera Developer',
      description: 'A digital artifact backed by Native HFS storage.',
      image: `hedera://${hfsFileId}`, // Points to the HFS image
      attributes: [
        { trait_type: 'Storage', value: 'Native HFS' }
      ],
      manifest_info: readmeContent.split('\n')[0],
      format: 'HIP412@2.0.0'
    }

    console.log('\n[LOG] Generated Metadata Manifest:')
    console.log(JSON.stringify(metadataJSON, null, 2))

    // 3. Mint the Serial
    console.log(`\n[PROCESS] Minting Serial #1 for Hashinal ${tokenId.toString()}...`)

    // Final pointer to the on-chain file bundle
    const pointer = `hedera://1/${hfsFileId}`

    // Mint: only the supply key can create new units or NFT serials.
    const mintTx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .addMetadata(Buffer.from(pointer))
      .freezeWith(client)

    const mintResponse = await mintTx.execute(client)
    const mintReceipt = await mintResponse.getReceipt(client)

    console.log(`[LOG] View Mint Transaction: ${getHashscanUrl(mintResponse)}`)
    console.log(`\n[SUCCESS] Success! NFT Serial #${mintReceipt.serials[0].toString()} now points directly to HFS File ${hfsFileId}`)

    console.log('\n KEY CONCEPT:')
    console.log('The hedera:// Protocol: This is a network-native way to reference')
    console.log('files. By using this URI in your metadata, you are making your assets')
    console.log('"Ledger-Native" and globally resolvable by any Hedera-compatible')
    console.log('application.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Hashinal Minting Failed:', error.message)
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
