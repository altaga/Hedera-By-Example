/**
 * ============================================================================
 * Lab 06: Base Layer Royalties (Secondary Protection)
 * [CONCEPT] Protocol-Level Artist Protection
 * ============================================================================
 * [ KEY CONCEPT ]
 * Protocol-Level Enforcement: On most other chains, royalties rely on "Marketplace
 * Honor Systems". Hedera's `CustomRoyaltyFee` is part of the token itself and
 * is enforced by the nodes at the ledger level. This ensures creators are
 * mathematically guaranteed their cut regardless of which marketplace is used.
 *
 *
 * [ LEARNABLE MOMENT ]
 * On other blockchains, secondary NFT marketplaces can bypass creator royalties. On Hedera the network itself takes the royalty out of the payment on every resale, and charges the fallback fee to the receiver when nothing is paid. Sales out of the treasury (the primary sale) pay no royalty.
 *
 * [ OFFICIAL REFERENCES ]
 * - https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/custom-token-fees#royalty-fee
 *
 * [ LEARNING PATH ]
 * - Previous: M3 Lab 05: Fee Modularity (Custom Fees)
 * - Next:     M3 Lab 07: Dynamic NFTs (HIP-657)
 *
 * [ SEQUENCE ]
 * Artist -> Hedera: TokenCreate NFT with 10% royalty + 0.01 ℏ fallback (Artist = treasury)
 * Artist -> Investor: Primary sale for 1 ℏ (from the treasury: no royalty)
 * Investor -> Buyer: Resale for 1 ℏ
 * Hedera -> Collector: 10% of the payment, taken by the network
 * Buyer -> Investor: Gift with no payment
 * Hedera -> Collector: Fallback fee, charged to the receiver
 *
 * [ BEFORE YOU RUN ]
 * - Wallet: your testnet account (it signs and pays the fees).
 * - Practice wallets: ACCOUNT_1 (artist) and ACCOUNT_2 (investor) (create them in the web Wallets panel, or set them in .env).
 * - It also creates a throwaway buyer account with 1.2 ℏ.
 * - Cost: ~30 ℏ the first time (it creates a token with custom fees, about 2 USD); ~1.5 ℏ when you run it again (the buyer account and fees).
 *
 * [ HOW TO RUN ]
 * node English/M3_Hedera_Token_Service/06_base_layer_royalties.js
 * ============================================================================
 */

import {
  AccountId,
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
import { getClient, createClient, ensureFunded, reuseToken, findOwnedSerial, createLabAccount } from '../M99_Utilities/index.js'

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

    console.log(`[INFO] Using ${account1Id} as Artist. Collector: ${operatorId}`)
    console.log('[PROCESS] Defining Artist Royalty (10% + 0.01 HBAR Fallback)...')

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
    console.log('[PROCESS] Issuing Royalty-Protected NFT Collection (RPN)...')
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
    console.log(`[SUCCESS] Token Created: ${tokenId.toString()}`)

    // 4. The artist's NFT: reuse one it already holds (the collection caps at 10), or mint one
    let serial = await findOwnedSerial(tokenId, account1Id)
    if (serial == null) {
      console.log(`[PROCESS] Minting an NFT for Token ${tokenId.toString()}...`)
      const mintReceipt = await (await new TokenMintTransaction()
        .setTokenId(tokenId)
        .setMetadata([Buffer.from('Asset #1')])
        .execute(client)).getReceipt(client)
      serial = Number(mintReceipt.serials[0])
    }
    console.log(`[LOG] Artist holds serial #${serial}`)

    // 5. Setup Investor (Account 2)
    console.log(`[PROCESS] Setting up Investor (${account2Id}) via association...`)
    const associate2Tx = await new TokenAssociateTransaction()
      .setAccountId(account2Id)
      .setTokenIds([tokenId])
      .freezeWith(client)
      .sign(account2PrivateKey)
    // The collection is reused across runs, and an account can only be associated once.
    await (async () => (await associate2Tx.execute(client)).getReceipt(client))().catch((error) => {
      if (!/TOKEN_ALREADY_ASSOCIATED/.test(String(error?.status ?? error?.message))) throw error
      console.log('[INFO] Already associated on an earlier run.')
    })
    console.log('[INFO] Investor Associated.')

    // What the network itself charged, read from the transaction record (not assumed).
    const assessed = (record) => record.assessedCustomFees
      .map((f) => `${Number(f.amount) / 1e8} ℏ from ${(f.payerAccountIds || []).join(', ')} to ${f.feeCollectorAccountId}`)
    const buyer = await createLabAccount(operatorClient, { hbar: 1.2 })
    console.log(`[LOG] Buyer for the resale: ${buyer.accountId} (throwaway account with 1.2 ℏ)`)

    // --- SCENARIO A: PRIMARY SALE (OUT OF THE TREASURY) ---
    console.log('\n--- Scenario A: Primary Sale (Artist -> Investor, 1 HBAR) ---')
    const primary = await (await (await (await new TransferTransaction()
      .addNftTransfer(tokenId, serial, account1Id, account2Id)
      .addHbarTransfer(account2Id, new Hbar(-1))
      .addHbarTransfer(account1Id, new Hbar(1))
      .freezeWith(client)
      .sign(account2PrivateKey)).execute(client)).getRecord(client))
    const primaryFees = assessed(primary)
    console.log(primaryFees.length
      ? `[LOG] Fees assessed by the network: ${primaryFees.join('; ')}`
      : '[SUCCESS] No royalty assessed: the NFT left the treasury (primary sale), which Hedera exempts.')

    // --- SCENARIO B: RESALE (ROYALTY) ---
    console.log('\n--- Scenario B: Resale (Investor -> Buyer, 1 HBAR): 10% Royalty ---')
    console.log('[PROCESS] The transfer pays the full 1 HBAR to the investor; the network takes the royalty from it...')
    const resale = await (await (await (await (await new TransferTransaction()
      .addNftTransfer(tokenId, serial, account2Id, buyer.accountId)
      .addHbarTransfer(buyer.accountId, new Hbar(-1))
      .addHbarTransfer(account2Id, new Hbar(1))
      .freezeWith(client)
      .sign(account2PrivateKey)).sign(buyer.privateKey)).execute(client)).getRecord(client))
    const resaleFees = assessed(resale)
    if (!resaleFees.length) throw new Error('The network assessed no royalty on the resale')
    console.log(`[SUCCESS] Royalty assessed by the network: ${resaleFees.join('; ')}`)

    // --- SCENARIO C: GIFT (FALLBACK FEE) ---
    console.log('\n--- Scenario C: Gift with no payment (Buyer -> Investor): Fallback Fee ---')
    const gift = await (await (await (await (await new TransferTransaction()
      .addNftTransfer(tokenId, serial, buyer.accountId, account2Id)
      .freezeWith(client)
      .sign(buyer.privateKey)).sign(account2PrivateKey)).execute(client)).getRecord(client))
    const giftFees = assessed(gift)
    if (!giftFees.length) throw new Error('The network assessed no fallback fee on the gift')
    console.log(`[SUCCESS] Fallback fee assessed by the network: ${giftFees.join('; ')} (the receiver pays it, since no value was exchanged).`)

    // Return the NFT to the artist so the next run reuses it (the collection caps at 10).
    const back = await (await (await (await new TransferTransaction()
      .addNftTransfer(tokenId, serial, account2Id, account1Id)
      .freezeWith(client)
      .sign(account2PrivateKey)).execute(client)).getRecord(client))
    const backFees = assessed(back)
    console.log(`[INFO] NFT #${serial} returned to the artist${backFees.length ? ` (fees assessed: ${backFees.join('; ')})` : ' (no fee: transfers into the treasury are exempt)'}.`)

    console.log('\n KEY CONCEPT:')
    console.log('Hedera forces royalties to be part of the atomic swap.')
    console.log('This ensures creators are mathematically guaranteed their cut.')

    client.close()
    console.log('\n--- SESSION COMPLETE ---')
  } catch (error) {
    console.error('\n[FAILED] Royalty Demonstration Failed:', error.message)
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
