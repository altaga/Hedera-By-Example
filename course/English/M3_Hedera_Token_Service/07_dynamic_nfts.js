/**
 * ============================================================================
 * Lab 07: Dynamic NFTs (HIP-765)
 * [ CONCEPT ] Mutable Metadata on HTS
 * ============================================================================
 * [ KEY CONCEPT ]
 * Historically, NFTs on Hedera were strictly immutable once minted.
 * With HIP-765, developers can assign a `metadataKey` to a token collection.
 * This allows the key holder to use `TokenUpdateNftsTransaction` to alter the
 * metadata of specific serial numbers AFTER they have been minted, enabling
 * dynamic NFTs (e.g., leveling up an RPG sword, changing real estate ownership,
 * or updating a decentralized identity badge).
 * *
 * [ LEARNABLE MOMENT ]
 * HIP-657 metadataKey provides controlled mutability for living digital assets: authorized systems can evolve character attributes, update credit scores, or reflect real-world asset valuations without re-minting.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-657
 *
 * [ LEARNING PATH ]
 * - Previous: M3 Lab 06: Base Layer Royalties
 * - Next:     M4 (Atomic Swaps)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD); <1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node 07_dynamic_nfts.js
 * ============================================================================
 */

import {
  NftId,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TokenMintTransaction,
  TokenUpdateNftsTransaction,
  TokenNftInfoQuery,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: Dynamic NFTs ---\n')

  const { client, operatorKey, operatorId } = getClient()
  const supplyKey = PrivateKey.fromString(operatorKey)
  // We use the same key as the metadataKey for simplicity
  const metadataKey = supplyKey

  try {
    // 1. Create an NFT Collection WITH a Metadata Key
    console.log('[⚙️ PROCESS] Creating Dynamic NFT Collection...')
    const tokenId = await reuseToken('REUSE_M3_07_TOKEN', async () => {
      const createTx = await new TokenCreateTransaction()
        .setTokenName('Dynamic Swords')
        .setTokenSymbol('SWORD')
        .setTokenType(TokenType.NonFungibleUnique)
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(supplyKey)
        // THIS IS THE SECRET SAUCE FOR DYNAMIC NFTs:
        .setMetadataKey(metadataKey)
        .freezeWith(client)
      const signed = await createTx.sign(supplyKey)
      return (await (await signed.execute(client)).getReceipt(client)).tokenId
    }, { check: (t) => !!t.metadata_key })
    let tx, signTx, submitTx, receipt // reused by the steps below

    console.log(`[✅ SUCCESS] Collection created! Token ID: ${tokenId.toString()}`)

    // 2. Mint a static Level 1 NFT
    console.log('\n[⚙️ PROCESS] Minting a Level 1 Sword...')
    const metadataLevel1 = Buffer.from('ipfs://bafkreihq.../level1.json')

    tx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata([metadataLevel1])
      .freezeWith(client)

    signTx = await tx.sign(supplyKey)
    submitTx = await signTx.execute(client)
    receipt = await submitTx.getReceipt(client)
    const serialNum = receipt.serials[0].toNumber()

    console.log(`[✅ SUCCESS] Minted Serial #${serialNum}`)

    // 3. Query the current metadata
    let nftInfo = await new TokenNftInfoQuery()
      .setNftId(new NftId(tokenId, serialNum))
      .execute(client)
    console.log(`[📊 LOG] Initial Metadata: ${Buffer.from(nftInfo[0].metadata).toString()}`)

    // 4. Update the NFT metadata (Level Up!)
    console.log('\n[⚙️ PROCESS] Player defeated boss. Leveling up Sword to Level 2...')
    const metadataLevel2 = Buffer.from('ipfs://bafybeig.../level2.json')

    tx = await new TokenUpdateNftsTransaction()
      .setTokenId(tokenId)
      .setSerialNumbers([serialNum])
      .setMetadata(metadataLevel2)
      .freezeWith(client)

    // Must be signed by the Metadata Key
    signTx = await tx.sign(metadataKey)
    submitTx = await signTx.execute(client)
    await submitTx.getReceipt(client)

    console.log('[✅ SUCCESS] NFT Metadata mutated on-ledger!')

    // 5. Query to prove the metadata changed
    nftInfo = await new TokenNftInfoQuery()
      .setNftId(new NftId(tokenId, serialNum))
      .execute(client)
    console.log(`[📊 LOG] New Metadata: ${Buffer.from(nftInfo[0].metadata).toString()}`)

    console.log('\n💡 KEY CONCEPT:')
    console.log('Dynamic NFTs open up entirely new paradigms for gaming, supply chain,')
    console.log('and ticketing. Hedera achieves this securely at the base layer without')
    console.log('relying on external, hackable smart contracts to manage metadata states.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Execution Error:', error.message)
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
