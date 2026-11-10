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
 * [ SIMULATED ]
 * The upload to a pinning service is simulated; the content IDs are real. The lab computes the exact
 * CIDv1 (raw, sha2-256) IPFS assigns to the image and to the metadata JSON (what
 * `ipfs add --cid-version=1` returns for a file this small), and the "pin" answers in the same
 * format as Pinata's pinFileToIPFS. Until someone uploads the same bytes, the ipfs:// links
 * do not resolve. The collection and the mint are real.
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
import { createHash } from 'node:crypto'
import fs from 'node:fs'
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
      website: 'https://hbe.expo.app'
    }
  }
}

/**
 * CIDv1 of a single-block file, as IPFS computes it (https://github.com/multiformats/cid):
 * <version 0x01><codec raw 0x55><multihash: sha2-256 0x12, length 0x20, digest>, in base32 ("b" prefix).
 */
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
const cidV1Raw = (bytes) => {
  const data = Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), createHash('sha256').update(bytes).digest()])
  let bits = 0
  let value = 0
  let out = 'b'
  for (const byte of data) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

// Same response shape as Pinata's POST /pinning/pinFileToIPFS (simulated: nothing is uploaded).
const simulatePin = (bytes) => ({ IpfsHash: cidV1Raw(bytes), PinSize: bytes.length, Timestamp: new Date().toISOString(), isDuplicate: false })

const main = async () => {
  console.log('--- SESSION START: HIP-412 Metadata ---')

  const { client, operatorKey, operatorId } = getClient()
  const supplyKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Content-address the image
    const image = fs.readFileSync(new URL('./assets/logonft.png', import.meta.url))
    const imagePin = simulatePin(image)
    console.log(`\n[PROCESS] Image: logonft.png (${image.length} bytes)`)
    console.log(`[LOG] Pin response (simulated): ${JSON.stringify(imagePin)}`)

    // 2. Generate the JSON Metadata pointing at the image's CID
    console.log('\n[PROCESS] Constructing HIP-412 Compliant JSON...')
    const metadataObj = generateHIP412Metadata(
      'HIP-412 Master Sword',
      `ipfs://${imagePin.IpfsHash}`,
      'A legendary sword forged in the fires of the Hedera consensus.',
      [
        { trait_type: 'Attack', value: 99 },
        { trait_type: 'Element', value: 'Fire' },
        { trait_type: 'Rarity', value: 'Legendary' }
      ]
    )
    console.log('[LOG] HIP-412 Payload:')
    console.log(JSON.stringify(metadataObj, null, 2))

    // 3. Content-address the metadata JSON: the NFT stores only this short URI (100-byte limit)
    const metadataBytes = Buffer.from(JSON.stringify(metadataObj))
    const metadataPin = simulatePin(metadataBytes)
    const metadataUri = `ipfs://${metadataPin.IpfsHash}`
    console.log(`\n[LOG] Pin response (simulated): ${JSON.stringify(metadataPin)}`)
    console.log(`[INFO] Metadata URI: ${metadataUri} (${Buffer.byteLength(metadataUri)} bytes, fits the 100-byte NFT metadata limit)`)

    // 4. Create the NFT Collection
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

    // 5. Mint the NFT with the HIP-412 URI
    console.log('\n[PROCESS] Minting NFT with HIP-412 Metadata URI...')
    const tx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata([Buffer.from(metadataUri)])
      .freezeWith(client)
    const receipt = await (await (await tx.sign(supplyKey)).execute(client)).getReceipt(client)
    const serialNum = receipt.serials[0].toNumber()
    console.log(`[SUCCESS] Minted Serial #${serialNum}`)

    // 6. Verify: read the URI back and check it is the CID of exactly these bytes
    const nftInfo = await new TokenNftInfoQuery()
      .setNftId(new NftId(tokenId, serialNum))
      .execute(client)
    const onChain = Buffer.from(nftInfo[0].metadata).toString()
    console.log(`\n[LOG] On-chain Metadata URI: ${onChain}`)
    if (onChain !== `ipfs://${cidV1Raw(metadataBytes)}`) throw new Error('The on-chain URI is not the CID of the metadata JSON')
    console.log('[VERIFY] The URI is the content ID of the metadata: any change to the JSON would change it.')
    console.log('[INFO] To make the links resolve, upload logonft.png and the same JSON bytes with `ipfs add --cid-version=1` (or a pinning service); they get these CIDs.')

    console.log('\n KEY CONCEPT:')
    console.log('Without HIP-412, your NFTs will appear as blank squares in wallets.')
    console.log('Standardization is critical for ecosystem interoperability, and a content ID')
    console.log('makes the metadata tamper-evident: the URI only matches the exact bytes.')

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
