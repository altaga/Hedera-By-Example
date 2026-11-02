/* eslint-disable camelcase, no-unused-vars, no-return-assign, no-use-before-define, promise/param-names */
/**
 * ============================================================================
 * Lab 06: Base Layer Royalties (Secondary Protection)
 * [ CONCEPT ] Protocol-Level Artist Protection
 * ============================================================================
 * [ KEY CONCEPT ]
 * Protocol-Level Enforcement: On most other chains, royalties rely on "Marketplace
 * Honor Systems". Hedera's `CustomRoyaltyFee` is part of the token itself and
 * is enforced by the nodes at the ledger level. This ensures creators are
 * mathematically guaranteed their cut regardless of which marketplace is used.
 * *
 * [ LEARNABLE MOMENT ]
 * On other blockchains, secondary NFT marketplaces can bypass creator royalties. On Hedera, royalties are enforced at Layer 1: transactions that do not fulfill the required royalty percentage fail at the protocol level.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/custom-token-fees#royalty-fee
 *
 * [ LEARNING PATH ]
 * - Previous: M3 Lab 05: Custom Fees
 * - Next:     M4 Lab 01: HBAR Transfers
 *
 * [ SEQUENCE ]
 * Artist -> Hedera: TokenCreate NFT with 10% royalty + 0.01 ℏ fallback
 * Artist -> Hedera: Mint NFT #1
 * Buyer -> Artist: Pay 1 ℏ for NFT #1 (one atomic transfer)
 * Hedera -> Collector: Royalty 0.1 ℏ enforced by the network
 * Note Hedera: No marketplace contract can skip the royalty
 *
 * [ HOW TO RUN ]
 * node 06_base_layer_royalties.js
 * ============================================================================
 */

import {
  AccountId,
  Client,
  CustomFixedFee,
  CustomRoyaltyFee,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TokenCreateTransaction,
  TokenMintTransaction,
  TokenSupplyType,
  TokenType,
  TransferTransaction
} from '@hiero-ledger/sdk'
import { getClient, createClient, ensureFunded, reuseToken } from '../M99_Utilities/index.js'

const main = async () => {
  console.log('--- SESSION START: NFT Base Layer Royalties ---\n')

  const { client: operatorClient, operatorId } = getClient()

  // Use Account 1 as the Artist & Payer for this simulation
  const account1Id = process.env.ACCOUNT_1_ID
  const account1Key = process.env.ACCOUNT_1_PRIVATE_KEY
  const account1PrivateKey = PrivateKey.fromString(account1Key)

  const client = createClient().setOperator(account1Id, account1PrivateKey)

  const account2Id = process.env.ACCOUNT_2_ID
  const account2PrivateKey = PrivateKey.fromString(process.env.ACCOUNT_2_PRIVATE_KEY)

  try {
    // The operator pays the token creation (Account 1 only signs as treasury), so the
    // practice accounts only need a little HBAR for the sale. Top them up if needed.
    await ensureFunded(operatorClient, account1Id, 2)
    await ensureFunded(operatorClient, account2Id, 2)

    console.log(`[ℹ️ INFO] Using ${account1Id} as Artist. Collector: ${operatorId}`)
    console.log('[⚙️ PROCESS] Defining Artist Royalty (10% + 0.01 HBAR Fallback)...')

    // 1. Fallback Fee: 0.01 HBAR
    const fallbackFee = new CustomFixedFee()
      .setAmount(1000000)
      .setFeeCollectorAccountId(AccountId.fromString(operatorId))

    // 2. Royalty Fee (10%)
    const royaltyFee = new CustomRoyaltyFee()
      .setNumerator(1)
      .setDenominator(10)
      .setFallbackFee(fallbackFee)
      .setFeeCollectorAccountId(AccountId.fromString(operatorId))

    // 3. Create NFT Collection
    console.log('[⚙️ PROCESS] Issuing Royalty-Protected NFT Collection (RPN)...')
    const tokenId = await reuseToken('REUSE_M3_06_TOKEN', async () => {
      const createTx = await new TokenCreateTransaction()
        .setTokenName('Royalty NFT')
        .setTokenSymbol('RPN')
        .setTokenType(TokenType.NonFungibleUnique)
        .setInitialSupply(0)
        .setTreasuryAccountId(AccountId.fromString(account1Id))
        .setSupplyType(TokenSupplyType.Finite)
        .setMaxSupply(10)
        .setSupplyKey(account1PrivateKey.publicKey)
        .setCustomFees([royaltyFee])
        .freezeWith(operatorClient)
      return (await (await (await createTx.sign(account1PrivateKey)).execute(operatorClient)).getReceipt(operatorClient)).tokenId
    }, { treasury: account1Id, check: (t) => (t.custom_fees?.royalty_fees || []).length > 0 })
    console.log(`[✅ SUCCESS] Token Created: ${tokenId.toString()}`)

    // 4. Mint NFT #1
    console.log(`[⚙️ PROCESS] Minting Serial #1 for Token ${tokenId.toString()}...`)
    const mintTx = await new TokenMintTransaction()
      .setTokenId(tokenId)
      .setMetadata([Buffer.from('Asset #1')])
      .execute(client)
    await mintTx.getReceipt(client)

    // 5. Setup Investor (Account 2)
    console.log(`[⚙️ PROCESS] Setting up Investor (${account2Id}) via association...`)
    const associate2Tx = await new TokenAssociateTransaction()
      .setAccountId(account2Id)
      .setTokenIds([tokenId])
      .freezeWith(client)
      .sign(account2PrivateKey)
    // The collection is reused across runs, and an account can only be associated once.
    await (async () => (await associate2Tx.execute(client)).getReceipt(client))().catch((error) => {
      if (!/TOKEN_ALREADY_ASSOCIATED/.test(String(error?.status ?? error?.message))) throw error
      console.log('[ℹ️ INFO] Already associated on an earlier run.')
    })
    console.log('[ℹ️ INFO] Investor Associated.')

    // --- SCENARIO A: SECONDARY SALE (ROYALTY) ---
    console.log('\n--- Scenario A: Secondary Sale (10% Royalty Triggered) ---')
    console.log('[⚙️ PROCESS] Account 1 (Artist) sells to Account 2 (Investor) for 1 HBAR...')

    const saleTx = await new TransferTransaction()
      .addNftTransfer(tokenId, 1, account1Id, account2Id)
      .addHbarTransfer(account2Id, new Hbar(-1.0)) // Buyer pays 1.0
      .addHbarTransfer(account1Id, new Hbar(0.9)) // Seller gets 0.9 (90%)
      .addHbarTransfer(operatorId, new Hbar(0.1)) // Collector gets 10%
      .freezeWith(client)
      .sign(account2PrivateKey)

    await (await saleTx.execute(client)).getReceipt(client)
    console.log('[✅ SUCCESS] Sale Complete. Protocol enforced: Artist +0.9 | Collector +0.1')

    // --- SCENARIO B: PRIVATE GIFT (FALLBACK FEE) ---
    console.log('\n--- Scenario B: Private Gift (Fallback Fee Triggered) ---')
    console.log('[⚙️ PROCESS] Investor sends NFT back to Artist with 0 HBAR transfer value...')

    const giftTx = await new TransferTransaction()
      .addNftTransfer(tokenId, 1, account2Id, account1Id)
      .freezeWith(client)
      .sign(account2PrivateKey)
    await (await giftTx.execute(client)).getReceipt(client)
    console.log('[✅ SUCCESS] Gift Complete. Fallback Fee of 0.01 HBAR was protocol-assessed.')

    console.log('\n💡 KEY CONCEPT:')
    console.log('Hedera forces royalties to be part of the atomic swap.')
    console.log('This ensures creators are mathematically guaranteed their cut.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[❌ FAILED] Royalty Demonstration Failed:', error.message)
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
