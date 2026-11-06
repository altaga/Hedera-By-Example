/**
 * ============================================================================
 * Lab 08: HIP-412 NFT Metadata
 * [CONCEPT] Standardized JSON Schema for NFTs
 * ============================================================================
 * [ KEY CONCEPT ]
 * HIP-412 defines the standard JSON schema for NFT metadata on Hedera.
 * By adhering to this schema, explorers (like Hashscan) and wallets
 * (like HashPack/Kabila) can properly render the image, attributes, and
 * properties of your NFT. The metadata is usually uploaded to IPFS (or HCS),
 * and the URI is passed to the `TokenMintTransaction`.
 * *
 * [ LEARNABLE MOMENT ]
 * Validating JSON schemas strictly against HIP412@2.0.0 prevents broken artwork and missing traits in explorers like Hashscan and wallets like HashPack, ensuring seamless ecosystem interoperability.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-412
 *
 * [ LEARNING PATH ]
 * - Previous: M3 Lab 07: Dynamic NFTs (HIP-657)
 * - Next:     M3 Lab 09: Treasury Supply-Key NFT Updates & Post-Distribution Lock (HIP-850)
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD); <1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M3_Hedera_Token_Service/08_hip412_metadata.js
 * ============================================================================
 */

import {
  NftId,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TokenMintTransaction,
  TokenNftInfoQuery,
  PrivateKey
} from '@hiero-ledger/sdk'
import { getClient, reuseToken } from '../M99_Utilities/index.js'

/**
 * Helper function to generate a strict HIP-412 compliant JSON.
 */
function generateHIP412Metadata (name, image, description, attributes) {
  return {
    name,
    creator: 'Hedera For Dummies Course',
    description,
    image, // Must be a valid URI (e.g., ipfs://...)
    type: 'image/png',
    format: 'HIP412@2.0.0', // Required by the standard
    attributes,
    properties: {
      collection: 'HIP-412 Educational Series',
      website: 'https://hedera.com'
    }
  }
}

const main = async () => {
  console.log('--- SESSION START: HIP-412 Metadata ---')

  const { client, operatorKey, operatorId } = getClient()
  const supplyKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Generate the JSON Metadata
    console.log('\n[PROCESS] Constructing HIP-412 Compliant JSON...')
    const metadataObj = generateHIP412Metadata(
      'HIP-412 Master Sword',
      'ipfs://bafkreifh3q3wxgfbsfbs5tqybbg34z62tdcugnsvf7y3c7n66n7pzybyzi', // Example IPFS CID
      'A legendary sword forged in the fires of the Hedera consensus.',
      [
        { trait_type: 'Attack', value: 99 },
        { trait_type: 'Element', value: 'Fire' },
        { trait_type: 'Rarity', value: 'Legendary' }
      ]
    )

    console.log('[LOG] HIP-412 Payload:')
    console.log(JSON.stringify(metadataObj, null, 2))

    // In a real production app, you would upload `metadataObj` to IPFS here
    // and use the resulting IPFS CID as the metadata buffer.
    // For this lab, we will embed the raw JSON directly as the metadata buffer
    // (Note: Hedera has a 100-byte limit on metadata natively, so usually you
    // only store the IPFS URI, e.g., Buffer.from('ipfs://...'). But for HCS/Hashinals
    // or smaller payloads, we illustrate the concept).
    // Let's assume we uploaded it and got a CID:
    const mockCid = 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/metadata.json'
    const metadataBuffer = Buffer.from(mockCid)

    // 2. Create the NFT Collection
    console.log('\n[PROCESS] Creating NFT Collection...')
    const tokenId = await reuseToken('REUSE_M3_08_TOKEN', async () => {
      const createTx = await new TokenCreateTransaction()
        .setTokenName('HIP-412 Items')
        .setTokenSymbol('ITM')
        .setTokenType(TokenType.NonFungibleUnique)
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(100)
        .setTreasuryAccountId(operatorId)
        .setSupplyKey(supplyKey)
        .freezeWith(client)
      const signed = await createTx.sign(supplyKey)
      return (await (await signed.execute(client)).getReceipt(client)).tokenId
    })
    console.log(`[SUCCESS] Collection created: ${tokenId.toString()}`)

    // 3. Mint the NFT with the HIP-412 URI
    console.log('\n[PROCESS] Minting NFT with HIP-412 Metadata URI...')
    const tx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata([metadataBuffer])
      .freezeWith(client)

    const signTx = await tx.sign(supplyKey)
    const submitTx = await signTx.execute(client)
    const receipt = await submitTx.getReceipt(client)
    const serialNum = receipt.serials[0].toNumber()
    console.log(`[SUCCESS] Minted Serial #${serialNum}`)

    // 4. Verify
    const nftInfo = await new TokenNftInfoQuery()
      .setNftId(new NftId(tokenId, serialNum))
      .execute(client)

    console.log(`\n[LOG] On-chain Metadata URI: ${Buffer.from(nftInfo[0].metadata).toString()}`)

    console.log('\n KEY CONCEPT:')
    console.log('Without HIP-412, your NFTs will appear as blank squares in wallets.')
    console.log('Standardization is critical for ecosystem interoperability.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Execution Error:', error.message)
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
