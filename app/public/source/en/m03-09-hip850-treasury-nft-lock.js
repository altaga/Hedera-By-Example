/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 09: Treasury Supply-Key NFT Updates & Post-Distribution Lock (HIP-850)
 * [ CONCEPT ] Pre-Distribution Dynamic Minting vs. Holder Immutability
 * ============================================================================
 * [ KEY CONCEPT ]
 * Before HIP-850, creators faced an all-or-nothing dilemma: either omit the
 * `metadataKey` (making typos or Blind-Box reveals impossible to fix in treasury)
 * or include a `metadataKey` (making collectors fear that the creator could rug-pull
 * or alter their NFT's artwork AFTER they bought it).
 * HIP-850 solves this at the consensus layer: EVEN WITHOUT a `metadataKey`, the
 * `supplyKey` is authorized to update NFT metadata via `TokenUpdateNftsTransaction`
 * ONLY while the NFT serial still resides in the Treasury Account. The moment the
 * NFT is transferred to a user, its metadata permanently locks!
 *
 * [ LEARNABLE MOMENT ]
 * This is the ultimate Web3 "Blind Box" / Reveal primitive: you can mint 10,000
 * mystery boxes in treasury, reveal or refine their metadata using the Supply Key,
 * and once delivered to collectors, the network mathematically guarantees that
 * nobody can ever mutate their asset again.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://hips.hedera.com/hip/hip-850
 * - https://hips.hedera.com/hip/hip-657
 *
 * [ LEARNING PATH ]
 * - Previous: M3 Lab 08: HIP-412 Metadata Schema
 * - Next:     M4 Lab 01: HBAR Transfers
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Cost: ~15 ℏ each run (it creates a token, about 1 USD).
 *
 * [ HOW TO RUN ]
 * node English/M3_Hedera_Token_Service/09_hip850_treasury_nft_lock.js
 * ============================================================================
 */

import {
  AccountCreateTransaction,
  Hbar,
  NftId,
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenNftInfoQuery,
  TokenSupplyType,
  TokenType,
  TokenUpdateNftsTransaction,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { getClient, updateState } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: HIP-850 Treasury Supply-Key Update & Lock ---\n')
  const { client, operatorId, operatorKey } = getClient()
  const supplyKey = PrivateKey.fromStringDer(operatorKey)

  try {
    // 1. Create an NFT Collection WITH SupplyKey ONLY (NO MetadataKey!)
    console.log('[⚙️ PROCESS] Creating NFT Collection with SupplyKey ONLY (No MetadataKey)...')
    // Create the token: its keys (admin, supply, KYC, freeze...) decide who can change it later.
    const createTx = await new TokenCreateTransaction()
      .setTokenName('HIP-850 Mystery Vault')
      .setTokenSymbol('VAULT')
      .setTokenType(TokenType.NonFungibleUnique)
      .setSupplyType(TokenSupplyType.Finite)
      .setMaxSupply(50)
      .setTreasuryAccountId(operatorId)
      .setSupplyKey(supplyKey)
      .freezeWith(client)

    const signedCreate = await createTx.sign(supplyKey)
    const createRes = await signedCreate.execute(client)
    // Wait for consensus: the receipt says whether the network accepted the transaction.
    const createReceipt = await createRes.getReceipt(client)
    const tokenId = createReceipt.tokenId
    console.log(`[✅ SUCCESS] Collection Created: ${tokenId.toString()} (MetadataKey: NONE)`)

    // 2. Mint Serial #1 with "Unrevealed Mystery Box" metadata in Treasury
    console.log('\n[⚙️ PROCESS] Minting Serial #1 in Treasury (Unrevealed Mystery State)...')
    const unrevealedMeta = Buffer.from('ipfs://bafkrei-mystery-box-unrevealed/box1.json')
    // Mint: only the supply key can create new units or NFT serials.
    const mintTx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata([unrevealedMeta])
      .freezeWith(client)

    const signedMint = await mintTx.sign(supplyKey)
    const mintRes = await signedMint.execute(client)
    const mintReceipt = await mintRes.getReceipt(client)
    const serialNum = mintReceipt.serials[0].toNumber()

    let nftInfo = await new TokenNftInfoQuery()
      .setNftId(new NftId(tokenId, serialNum))
      .execute(client)
    console.log(`[📊 LOG] Serial #${serialNum} Initial Metadata: ${Buffer.from(nftInfo[0].metadata).toString()}`)

    // 3. HIP-850 In Action: Update Metadata in Treasury using ONLY SupplyKey!
    console.log('\n[⚙️ PROCESS] [HIP-850] Updating Serial #1 in Treasury using SupplyKey...')
    const revealedMeta = Buffer.from('ipfs://bafkrei-genesis-dragon-revealed/dragon1.json')
    // Update NFT metadata: only the metadata key can do this (HIP-657).
    const updateTreasuryTx = await new TokenUpdateNftsTransaction()
      .setTokenId(tokenId)
      .setSerialNumbers([serialNum])
      .setMetadata(revealedMeta)
      .freezeWith(client)

    const signedTreasuryUpdate = await updateTreasuryTx.sign(supplyKey)
    const updateRes = await signedTreasuryUpdate.execute(client)
    await updateRes.getReceipt(client)

    nftInfo = await new TokenNftInfoQuery()
      .setNftId(new NftId(tokenId, serialNum))
      .execute(client)
    console.log('[✅ SUCCESS] HIP-850 Treasury Reveal Succeeded!')
    console.log(`[📊 LOG] Serial #${serialNum} Revealed Metadata: ${Buffer.from(nftInfo[0].metadata).toString()}`)

    // 4. Transfer Serial #1 out of Treasury to a Collector Account
    console.log('\n[⚙️ PROCESS] Creating Collector Account and transferring Serial #1 out of Treasury...')
    // Generate a key locally: the private key never leaves this process.
    const collectorKey = PrivateKey.generateED25519()
    // Create an account: its key controls it; the initial balance comes from the payer.
    const accRes = await new AccountCreateTransaction()
      .setKeyWithoutAlias(collectorKey.publicKey)
      .setInitialBalance(new Hbar(0))
      .setMaxAutomaticTokenAssociations(5)
      .execute(client)
    const collectorId = (await accRes.getReceipt(client)).accountId

    // Build the transfer: debits (negative) and credits (positive) in one transaction must add up to zero.
    const transferRes = await new TransferTransaction()
      .addNftTransfer(tokenId, serialNum, operatorId, collectorId)
      .execute(client)
    await transferRes.getReceipt(client)
    console.log(`[✅ SUCCESS] Serial #${serialNum} delivered to Collector (${collectorId.toString()})!`)

    // 5. Prove Post-Distribution Immutability Lock: SupplyKey can NO LONGER mutate it!
    console.log('\n[⚙️ PROCESS] Attempting to mutate Serial #1 AFTER leaving Treasury (Should FAIL)...')
    let lockedAsExpected = false
    try {
      const illegalUpdateTx = await new TokenUpdateNftsTransaction()
        .setTokenId(tokenId)
        .setSerialNumbers([serialNum])
        .setMetadata(Buffer.from('ipfs://rugged-metadata'))
        .freezeWith(client)
      const signedIllegal = await illegalUpdateTx.sign(supplyKey)
      const illegalRes = await signedIllegal.execute(client)
      await illegalRes.getReceipt(client)
    } catch (err) {
      lockedAsExpected = true
      console.log(`[🛡️ IMMUTABILITY LOCKED] Consensus rejected post-distribution edit: ${err.message}`)
    }

    updateState('HIP850_TOKEN_ID', tokenId.toString())
    updateState('HIP850_COLLECTOR_ID', collectorId.toString())
    updateState('HIP850_IMMUTABILITY_VERIFIED', lockedAsExpected)

    console.log('\n💡 KEY CONCEPT:')
    console.log('HIP-850 gives issuers pre-distribution flexibility in the Treasury Account')
    console.log('while guaranteeing 100% mathematical immutability once the NFT reaches the collector.')

    console.log('\n💡 LEARNABLE MOMENT:')
    console.log('Security and UX do not have to be a trade-off. By tying mutability to Treasury')
    console.log('custody, Hedera eliminates the "rug-pullable metadataKey" risk for collectors.')

    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ ERROR] HIP-850 Execution Failure:', error.message)
    process.exit(1)
  } finally {
    client.close()
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
