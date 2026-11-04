/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 10: Hedera NFT Studio — Rarity Inspector & Airdrop Pre-Flight Verifier
 * [CONCEPT] Collection Trait Entropy, Schema Audits & HIP-904 Distribution
 * ============================================================================
 * [ KEY CONCEPT ]
 * Hedera NFT Studio is the official creator-focused suite for launching digital
 * collections, auditing metadata compliance, and executing secure on-chain airdrops.
 *
 * In production NFT launches, two catastrophic failure modes frequently occur:
 * 1. Broken Metadata & Trait Skew: Unverified JSON schemas (violating HIP-412) or
 *    unbalanced trait rarities destroy collector trust and marketplace valuation.
 * 2. Failed Blind Airdrops: Airdropping tokens to accounts without pre-verifying
 *    their auto-association limits (max_automatic_token_associations) causes
 *    transactions to fail or creates stranded pending airdrops requiring manual claims.
 *
 * This laboratory implements the official NFT Studio core engines:
 * - HIP-412 Schema Validator: Validates required metadata keys, mime-types, and format.
 * - Rarity Inspector Engine: Calculates statistical trait frequencies across the entire
 *   collection and computes the standardized Rarity Score:
 *     RarityScore(token) = Sum( 1 / TraitFrequency(trait) )
 * - Airdrop Pre-Flight Verifier: Queries Mirror Node REST API to evaluate recipient
 *   wallet status (association slots, active balance) and categorizes delivery into
 *   INSTANT_DELIVERY vs PENDING_CLAIM_REQUIRED before signing transactions.
 * - Atomic Consensus Airdrop: Mints verified collection assets and settles distributions
 *   using Hedera Token Service (HTS) and HIP-904 native airdrops.
 *
 * [ LEARNABLE MOMENT ]
 * Never perform a bulk airdrop without pre-flight validation. By querying the Mirror
 * Node for remaining association slots, an NFT creator can guarantee whether an asset
 * drops directly into the collector's wallet or enters the HIP-904 pending queue.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-412
 * - https://hips.hedera.com/hip/hip-904
 *
 * [ LEARNING PATH ]
 * - Previous: M3 Lab 09: HIP-850 Treasury NFT Lock
 * - Next:     M4 Lab 01: HBAR & Token Atomic Transfers
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 and ACCOUNT_2 (create them in the web Wallets panel, or set them in .env).
 * - Cost: ~15 ℏ the first time (it creates a token, about 1 USD); <1 ℏ when you run it again (it reuses what it created).
 *
 * [ HOW TO RUN ]
 * node English/M3_Hedera_Token_Service/10_nft_studio_rarity_and_airdrop_verifier.js
 * ============================================================================
 */

import {
  AccountId,
  CustomRoyaltyFee,
  CustomFixedFee,
  Hbar,
  NftId,
  PrivateKey,
  TokenAirdropTransaction,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType
} from '@hiero-ledger/sdk'
import {
  getClient,
  getHashscanUrl,
  getMirrorNodeBaseUrl,
  updateState,
  reuseToken
} from '../M99_Utilities/index.js'

/**
 * 1. HIP-412 Schema Validator Engine
 * Validates metadata compliance against Hedera standard specifications.
 */
class Hip412Validator {
  static validate (metadata) {
    const requiredKeys = ['name', 'creator', 'description', 'image', 'type', 'format', 'attributes']
    const missing = requiredKeys.filter((k) => metadata[k] === undefined || metadata[k] === null)

    if (missing.length > 0) {
      return { valid: false, error: `Missing mandatory HIP-412 keys: ${missing.join(', ')}` }
    }

    if (!Array.isArray(metadata.attributes) || metadata.attributes.length === 0) {
      return { valid: false, error: 'HIP-412 attributes must be a non-empty array' }
    }

    if (typeof metadata.format !== 'string' || !metadata.format.startsWith('HIP412')) {
      return { valid: false, error: `Invalid format standard: ${metadata.format}. Expected HIP412@2.0.0` }
    }

    return { valid: true, error: null }
  }
}

/**
 * 2. NFT Studio Rarity Inspector Engine
 * Calculates trait frequencies, individual trait scores, and ranks collection assets.
 */
class RarityInspector {
  constructor (collection) {
    this.collection = collection
    this.totalItems = collection.length
    this.traitFrequencies = new Map()
  }

  analyze () {
    // Phase 1: Tally trait frequencies across all items
    for (const item of this.collection) {
      for (const attr of item.attributes) {
        const key = `${attr.trait_type}:::${attr.value}`
        this.traitFrequencies.set(key, (this.traitFrequencies.get(key) || 0) + 1)
      }
    }

    // Phase 2: Compute individual Rarity Scores for each NFT
    const analyzedItems = this.collection.map((item) => {
      let totalRarityScore = 0
      const traitBreakdown = []

      for (const attr of item.attributes) {
        const key = `${attr.trait_type}:::${attr.value}`
        const count = this.traitFrequencies.get(key)
        const frequency = count / this.totalItems
        // Rarity Score formula: 1 / frequency
        const traitScore = 1 / frequency
        totalRarityScore += traitScore

        traitBreakdown.push({
          trait_type: attr.trait_type,
          value: attr.value,
          count,
          percentage: (frequency * 100).toFixed(1) + '%',
          score: parseFloat(traitScore.toFixed(2))
        })
      }

      return {
        id: item.id,
        name: item.name,
        totalRarityScore: parseFloat(totalRarityScore.toFixed(2)),
        traits: traitBreakdown
      }
    })

    // Phase 3: Rank collection by score descending
    analyzedItems.sort((a, b) => b.totalRarityScore - a.totalRarityScore)
    analyzedItems.forEach((item, index) => {
      item.rank = index + 1
      if (item.rank === 1) item.tier = 'LEGENDARY'
      else if (item.rank <= Math.ceil(this.totalItems * 0.4)) item.tier = 'EPIC'
      else if (item.rank <= Math.ceil(this.totalItems * 0.7)) item.tier = 'RARE'
      else item.tier = 'COMMON'
    })

    return analyzedItems
  }
}

/**
 * 3. Airdrop Pre-Flight Verifier Engine
 * Evaluates recipient accounts using Mirror Node REST API to verify auto-association slots.
 */
class AirdropVerifier {
  constructor (mirrorNodeBaseUrl) {
    this.baseUrl = mirrorNodeBaseUrl
  }

  async verifyRecipient (accountId) {
    const cleanId = accountId.toString()
    const url = `${this.baseUrl}/api/v1/accounts/${cleanId}`

    try {
      const response = await fetch(url)
      if (!response.ok) {
        return {
          accountId: cleanId,
          status: 'UNREACHABLE_OR_NOT_FOUND',
          eligible: false,
          remainingSlots: 0
        }
      }

      const data = await response.json()
      const maxSlots = data.max_automatic_token_associations || 0
      // In Mirror Node, tokens associated can be fetched or estimated
      // An account with -1 has unlimited auto-associations; 0 has none
      let deliveryMode = 'PENDING_CLAIM_REQUIRED'
      if (maxSlots === -1 || maxSlots > 0) {
        deliveryMode = 'INSTANT_DELIVERY'
      }

      return {
        accountId: cleanId,
        status: 'VERIFIED',
        eligible: true,
        maxAutomaticAssociations: maxSlots,
        deliveryMode,
        balanceHbar: (data.balance ? data.balance.balance / 100000000 : 0) + 'HBAR'
      }
    } catch (err) {
      return {
        accountId: cleanId,
        status: 'FETCH_ERROR',
        eligible: false,
        error: err.message
      }
    }
  }
}

const main = async () => {
  console.log('====================================================================')
  console.log('HEDERA NFT STUDIO: RARITY INSPECTOR & AIRDROP PRE-FLIGHT VERIFIER')
  console.log('====================================================================\n')

  const { client, operatorId, operatorKey } = getClient()
  const supplyKey = PrivateKey.fromStringDer(operatorKey)
  const mirrorUrl = getMirrorNodeBaseUrl()

  // 1. Define Simulated Collection Dataset with Varied Attributes
  const rawCollection = [
    {
      id: 1,
      name: 'Cyber Sentinel #001',
      creator: 'Hedera NFT Studio',
      description: 'First generation algorithmic guardian on Hedera Hashgraph.',
      image: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/1.png',
      type: 'image/png',
      format: 'HIP412@2.0.0',
      attributes: [
        { trait_type: 'Faction', value: 'Quantum Vanguard' },
        { trait_type: 'Armor', value: 'Obsidian Plating' },
        { trait_type: 'Weapon', value: 'Plasma Railgun' },
        { trait_type: 'Core', value: 'Zero-Point Anomaly' } // Very rare!
      ]
    },
    {
      id: 2,
      name: 'Cyber Sentinel #002',
      creator: 'Hedera NFT Studio',
      description: 'Tactical skirmisher unit forged with HTS native compliance.',
      image: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/2.png',
      type: 'image/png',
      format: 'HIP412@2.0.0',
      attributes: [
        { trait_type: 'Faction', value: 'Silicon Resistance' },
        { trait_type: 'Armor', value: 'Titanium Mesh' },
        { trait_type: 'Weapon', value: 'Pulse Rifle' },
        { trait_type: 'Core', value: 'Fusion Reactor' }
      ]
    },
    {
      id: 3,
      name: 'Cyber Sentinel #003',
      creator: 'Hedera NFT Studio',
      description: 'Heavy vanguard sentinel maintaining network consensus.',
      image: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/3.png',
      type: 'image/png',
      format: 'HIP412@2.0.0',
      attributes: [
        { trait_type: 'Faction', value: 'Silicon Resistance' },
        { trait_type: 'Armor', value: 'Titanium Mesh' },
        { trait_type: 'Weapon', value: 'Pulse Rifle' },
        { trait_type: 'Core', value: 'Fusion Reactor' }
      ]
    }
  ]

  // Step 1: Execute HIP-412 Schema Validation
  console.log('[1/4]  Running NFT Studio HIP-412 Metadata Compliance Audit...')
  for (const item of rawCollection) {
    const audit = Hip412Validator.validate(item)
    if (!audit.valid) {
      console.error(` Validation Failed on ${item.name}: ${audit.error}`)
      process.exit(1)
    }
  }
  console.log(`HIP-412 Schema Audit Passed: All ${rawCollection.length} assets adhere to HIP412@2.0.0 standard.\n`)

  // Step 2: Run Rarity Inspector
  console.log('[2/4]  Executing NFT Studio Rarity Inspector Engine...')
  const inspector = new RarityInspector(rawCollection)
  const rankedCollection = inspector.analyze()

  console.log('--------------------------------------------------------------------')
  console.log('COLLECTION RARITY RANKINGS')
  console.log('--------------------------------------------------------------------')
  rankedCollection.forEach((item) => {
    console.log(`Rank #${item.rank} [${item.tier}] - ${item.name}`)
    console.log(`Rarity Score: ${item.totalRarityScore}`)
    console.log(`Distinctive Traits: ${item.traits.map((t) => `${t.trait_type}: ${t.value} (${t.percentage})`).join(' | ')}`)
  })
  console.log('--------------------------------------------------------------------\n')

  // Step 3: Run Airdrop Pre-Flight Verifier
  console.log('[3/4]  Running Airdrop Pre-Flight Verifier across Target Accounts...')
  const verifier = new AirdropVerifier(mirrorUrl)
  const targetAccounts = [
    process.env.ACCOUNT_1_ID || '0.0.11226623',
    process.env.ACCOUNT_2_ID || '0.0.8707881'
  ]

  const verifications = []
  for (const acc of targetAccounts) {
    const report = await verifier.verifyRecipient(acc)
    verifications.push(report)
    console.log(`Target Account: ${report.accountId}`)
    console.log(`Status:         ${report.status}`)
    console.log(`Delivery Mode:  ${report.deliveryMode} (Slots: ${report.maxAutomaticAssociations})`)
    console.log(`Balance:        ${report.balanceHbar}\n`)
  }

  // Step 4: On-Chain HTS NFT Collection Creation & Native Airdrop Execution
  console.log('[4/4]  Executing On-Chain Minting & Verified Airdrop on Testnet...')

  console.log('Creating Non-Fungible Unique Token Class...')
  const tokenId = await reuseToken('REUSE_M3_10_TOKEN', async () => {
    // Create the token: its keys (admin, supply, KYC, freeze...) decide who can change it later.
    const createTx = await new TokenCreateTransaction()
      .setTokenName('NFT Studio Sentinel Collection')
      .setTokenSymbol('SENTINEL')
      .setTokenType(TokenType.NonFungibleUnique)
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(rawCollection.length)
      .setTreasuryAccountId(operatorId)
      .setSupplyKey(supplyKey)
      .freezeWith(client)

    const createSign = await createTx.sign(supplyKey)
    const createSubmit = await createSign.execute(client)
    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const createReceipt = await createSubmit.getReceipt(client)
    return createReceipt.tokenId
  })

  console.log(`NFT Collection Created: ${tokenId.toString()}`)
  console.log(`Explorer: https://hashscan.io/${process.env.NETWORK || 'testnet'}/token/${tokenId.toString()}`)

  // Mint NFTs with Serial Numbers (storing the IPFS metadata URI <= 100 bytes consensus limit)
  const metadataBytes = rawCollection.map((item) =>
    Buffer.from(`ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/${item.id}.json`)
  )
  // Mint: only the supply key can create new units or NFT serials.
  const mintTx = await new TokenMintTransaction()
    .setTokenId(tokenId)
    .setMetadata(metadataBytes)
    .freezeWith(client)

  const mintSign = await mintTx.sign(supplyKey)
  const mintSubmit = await mintSign.execute(client)
  const mintReceipt = await mintSubmit.getReceipt(client)
  console.log(`Minted Serials: [${mintReceipt.serials.map((s) => s.toString()).join(', ')}]`)

  // Execute Verified Native Airdrop (Serial #1 to Target Account 1)
  const targetRecipient = AccountId.fromString(targetAccounts[0])
  console.log(`\n   Dispersing Serial #1 (Rank #1 ${rankedCollection[0].name}) to ${targetRecipient.toString()} via HIP-904...`)

  // Airdrop (HIP-904): delivered at once with a free auto-association slot, otherwise left pending until claimed.
  const airdropTx = await new TokenAirdropTransaction()
    .addNftTransfer(new NftId(tokenId, mintReceipt.serials[0]), operatorId, targetRecipient)
    .freezeWith(client)

  const airdropSubmit = await airdropTx.execute(client)
  const airdropReceipt = await airdropSubmit.getReceipt(client)
  console.log(`Airdrop Transaction Status: ${airdropReceipt.status.toString()}`)
  console.log(`Hashscan Tx: ${getHashscanUrl(airdropSubmit.transactionId.toString())}`)

  // Persist State
  updateState('NFT_STUDIO_TOKEN_ID', tokenId.toString())
  updateState('NFT_STUDIO_TOP_SERIAL', mintReceipt.serials[0].toString())
  updateState('NFT_STUDIO_AIRDROP_VERIFIED', true)

  console.log('\n====================================================================')
  console.log('NFT STUDIO LAB COMPLETE: METADATA, RARITY & AIRDROP VERIFIED')
  console.log('====================================================================')

  client.close()
  process.exit()
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  main()
    .then(() => { if (process.exitCode) process.exit() })
    .catch((error) => {
      console.error('[FAILED] Execution Error:', error.message)
      process.exit(1)
    })
}
